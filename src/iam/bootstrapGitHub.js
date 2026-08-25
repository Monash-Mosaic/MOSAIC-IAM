import { logger } from "../utils/logger.js";
import { getGitHubUserProfile, listOrgMembers } from "../github/members.js";
import { listTeamMembers, resolveTeam } from "../github/teams.js";
import {
  findTrackingRecord,
  findTrackingRecordByGithubLogin,
  upsertAccessTracking,
} from "../notion/accessTracking.js";
import { getDataSourceSchema } from "../notion/fields.js";
import { getAllResources } from "../notion/resources.js";
import { getAllUsers, upsertImportedIamUser } from "../notion/users.js";
import { loadGitHubMigrationMapping, mapGitHubLoginToUser } from "./githubIdentity.js";
import { reportMappedOption } from "./bootstrapOptions.js";

function isGitHubTeamResource(resource) {
  return (
    String(resource.provider ?? "").trim().toLowerCase() === "github" &&
    String(resource.resourceType ?? "").trim().toLowerCase() === "team"
  );
}

function mergeUsers(notionUsers, extraUsers = []) {
  const byEmail = new Map();
  for (const user of notionUsers) {
    byEmail.set(user.email, { ...user });
  }
  for (const user of extraUsers) {
    const email = String(user.email ?? "").trim().toLowerCase();
    if (!email) {
      continue;
    }
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, { ...user, email });
      continue;
    }
    byEmail.set(email, {
      ...existing,
      name: existing.name || user.name,
      slackUserId: existing.slackUserId || user.slackUserId,
      githubUsername: existing.githubUsername || user.githubUsername,
      pageId: existing.pageId && existing.pageId !== "dry-run" ? existing.pageId : user.pageId,
    });
  }
  return [...byEmail.values()];
}

export async function bootstrapGitHub({ dryRun = false, knownUsers = [] } = {}) {
  const trackingSchema = await getDataSourceSchema("accessTracking");
  reportMappedOption(trackingSchema, "source", "Imported", {
    imported: ["Imported"],
  });
  reportMappedOption(trackingSchema, "status", "Active", {
    active: ["Granted", "Active"],
  });
  reportMappedOption(trackingSchema, "action", "Existing Access", {
    "existing access": ["Existing Access", "Grant"],
  });

  const [orgMembers, resources, notionUsers] = await Promise.all([
    listOrgMembers(),
    getAllResources(),
    getAllUsers(),
  ]);
  const iamTeams = resources.filter(isGitHubTeamResource);
  const users = mergeUsers(notionUsers, knownUsers);
  const migrationMap = loadGitHubMigrationMapping();

  const mappingCache = new Map();

  async function resolveIdentity(login) {
    const key = String(login).trim().toLowerCase();
    if (mappingCache.has(key)) {
      return mappingCache.get(key);
    }
    const profile = await getGitHubUserProfile(login);
    const mapped = mapGitHubLoginToUser(
      { login, email: profile?.email || "" },
      users,
      migrationMap,
    );
    if (mapped.user) {
      if (!mapped.user.githubUsername) {
        mapped.user.githubUsername = login;
        if (mapped.user.pageId && mapped.user.pageId !== "dry-run") {
          await upsertImportedIamUser({
            name: mapped.user.name,
            email: mapped.user.email,
            githubUsername: login,
            dryRun,
          });
        }
      }
    } else {
      logger.info(
        "[GITHUB]",
        `GitHub user ${login} has no IAM email match; importing Access Tracking for manual user assignment.`,
      );
    }
    mappingCache.set(key, mapped);
    return mapped;
  }

  for (const member of orgMembers) {
    await resolveIdentity(member.login);
  }

  let trackingCreates = 0;
  let trackingUpdates = 0;
  let unmappedTracking = 0;

  for (const resource of iamTeams) {
    const team = await resolveTeam({
      externalResourceId: resource.externalResourceId,
      externalName: resource.externalName,
      code: resource.code,
    });
    if (!team) {
      logger.warn(
        "[GITHUB]",
        `Skipping IAM GitHub team ${resource.code}: could not resolve the GitHub team`,
      );
      continue;
    }
    const members = await listTeamMembers({ teamSlug: team.slug });
    for (const member of members) {
      const mapped = await resolveIdentity(member.login);
      const user = mapped.user?.email ? mapped.user : null;
      const existing = user
        ? await findTrackingRecord(user, resource.code, resource.pageId)
        : await findTrackingRecordByGithubLogin(member.login, resource.code, resource.pageId);

      await upsertAccessTracking({
        user,
        policy: null,
        resource: {
          ...resource,
          externalResourceId: team.id,
        },
        status: "active",
        githubLogin: member.login,
        source: "Imported",
        action: "Existing Access",
        dryRun,
      });

      if (!user) {
        unmappedTracking += 1;
      }
      if (existing) {
        trackingUpdates += 1;
      } else {
        trackingCreates += 1;
      }
    }
  }

  const mappedAutomatically = [...mappingCache.values()].filter((item) => item.user).length;
  const unresolvedLogins = [...mappingCache.entries()]
    .filter(([, item]) => !item.user)
    .map(([login]) => login);

  if (unmappedTracking) {
    logger.info(
      "[GITHUB]",
      `${unmappedTracking} Access Tracking row(s) left without a Users relation — assign IAM users manually.`,
    );
  }

  return {
    orgMembers: orgMembers.length,
    teamsScanned: iamTeams.length,
    mappedAutomatically,
    unresolved: unresolvedLogins.length,
    unresolvedLogins,
    unmappedTracking,
    trackingCreates,
    trackingUpdates,
    trackingTotal: trackingCreates + trackingUpdates,
  };
}
