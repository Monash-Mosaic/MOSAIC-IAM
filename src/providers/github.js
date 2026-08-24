import { allowsDestructiveRevocation } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  cancelOrgInvitation,
  createOrgInvitation,
  findPendingInvitationByEmail,
  formatGitHubError,
  getInvitationTeams,
  isAlreadyInvitedError,
  isAlreadyMemberError,
} from "../github/invitations.js";
import { findMemberByEmail } from "../github/members.js";
import { addTeamMember, isTeamMember, resolveTeam } from "../github/teams.js";

function uniqueTeamIds(ids) {
  return [...new Set(ids.map(Number).filter(Boolean))];
}

function hasAllDesiredTeams(attachedIds, desiredIds) {
  const attached = new Set(attachedIds.map(Number));
  return desiredIds.every((id) => attached.has(Number(id)));
}

async function resolveGitHubTeams(resources) {
  const resolved = [];
  for (const resource of resources) {
    if (!resource.provisionEnabled) {
      resolved.push({
        resource,
        status: "skipped",
        error: "Provision is disabled for this resource",
      });
      continue;
    }

    const team = await resolveTeam({
      externalResourceId: resource.externalResourceId,
      externalName: resource.externalName,
      code: resource.code,
    });

    if (!team) {
      const error = `GitHub team resource ${resource.code} has no External Resource ID and could not be resolved.`;
      logger.error("[ERROR]", error);
      resolved.push({ resource, status: "failed", error });
      continue;
    }

    if (!resource.externalResourceId) {
      logger.warn(
        "[GITHUB]",
        `Resolved ${resource.code} to team ID ${team.id} via name/slug. Populate External Resource ID in Notion.`,
      );
    }

    resolved.push({
      resource: {
        ...resource,
        externalResourceId: team.id,
        teamSlug: team.slug,
        teamName: team.name,
      },
      status: "resolved",
      team,
    });
  }
  return resolved;
}

async function ensureTeamMemberships(username, resolvedTeams, dryRun) {
  const results = [];
  for (const item of resolvedTeams) {
    const alreadyMember = await isTeamMember({
      teamSlug: item.team.slug,
      username,
    });
    if (alreadyMember) {
      results.push({ ...item, status: "active", mutated: false });
      continue;
    }
    if (dryRun) {
      logger.info("[GITHUB]", `DRY RUN would add ${username} to team ${item.team.slug}`);
      results.push({ ...item, status: "pending", mutated: true });
      continue;
    }
    await addTeamMember({ teamSlug: item.team.slug, username });
    results.push({ ...item, status: "active", mutated: true });
  }
  return results;
}

export async function reconcileGitHubAccess({ user, resources, trackingRecords, dryRun = false }) {
  const githubResources = resources.filter(
    (resource) =>
      String(resource.provider ?? "").trim().toLowerCase() === "github" &&
      String(resource.resourceType ?? "").trim().toLowerCase() === "team",
  );

  if (!githubResources.length) {
    return {
      provider: "GitHub",
      invitationCreated: false,
      mutated: false,
      githubLogin: null,
      invitationId: null,
      results: [],
    };
  }

  const resolved = await resolveGitHubTeams(githubResources);
  const failed = resolved.filter((item) => item.status === "failed");
  const skipped = resolved.filter((item) => item.status === "skipped");
  const teams = resolved.filter((item) => item.status === "resolved");
  const desiredTeamIds = uniqueTeamIds(teams.map((item) => item.team.id));
  const knownLogin = trackingRecords.find((record) => record.githubLogin)?.githubLogin ?? null;

  logger.info(
    "[IAM]",
    `Resource resolved: ${githubResources.map((resource) => resource.code).join(", ")}`,
  );

  if (!teams.length) {
    return {
      provider: "GitHub",
      invitationCreated: false,
      mutated: false,
      githubLogin: knownLogin,
      invitationId: null,
      results: [...failed, ...skipped],
    };
  }

  const pendingInvitation = await findPendingInvitationByEmail(user.email);
  if (pendingInvitation) {
    logger.info("[GITHUB]", `Existing pending invitation found: ${pendingInvitation.id}`);
    const invitationTeams = await getInvitationTeams(pendingInvitation.id);
    const attachedIds = invitationTeams.map((team) => team.id);
    const githubLogin = pendingInvitation.login || knownLogin;

    if (hasAllDesiredTeams(attachedIds, desiredTeamIds)) {
      logger.info("[GITHUB]", "Pending invitation already contains all desired teams");
      return {
        provider: "GitHub",
        invitationCreated: false,
        mutated: false,
        githubLogin,
        invitationId: pendingInvitation.id,
        results: [
          ...teams.map((item) => ({
            ...item,
            status: "pending",
            invitationId: pendingInvitation.id,
            githubLogin,
            mutated: false,
          })),
          ...failed,
          ...skipped,
        ],
      };
    }

    if (dryRun) {
      logger.info(
        "[GITHUB]",
        `DRY RUN would replace invitation ${pendingInvitation.id} with teams ${desiredTeamIds.join(", ")}`,
      );
      return {
        provider: "GitHub",
        invitationCreated: true,
        mutated: true,
        githubLogin,
        invitationId: pendingInvitation.id,
        results: teams.map((item) => ({ ...item, status: "pending", mutated: true })),
      };
    }

    await cancelOrgInvitation(pendingInvitation.id);
    const invitation = await createOrgInvitation({
      email: user.email,
      teamIds: desiredTeamIds,
    });
    return {
      provider: "GitHub",
      invitationCreated: true,
      mutated: true,
      githubLogin: invitation.login || githubLogin,
      invitationId: invitation.id,
      results: [
        ...teams.map((item) => ({
          ...item,
          status: "pending",
          invitationId: invitation.id,
          githubLogin: invitation.login || githubLogin,
          mutated: true,
        })),
        ...failed,
        ...skipped,
      ],
    };
  }

  const member = await findMemberByEmail(user.email, knownLogin);
  if (member) {
    logger.info("[GITHUB]", `Existing organisation membership found: ${member.login}`);
    const membershipResults = await ensureTeamMemberships(member.login, teams, dryRun);
    return {
      provider: "GitHub",
      invitationCreated: false,
      mutated: membershipResults.some((item) => item.mutated),
      githubLogin: member.login,
      invitationId: null,
      results: [...membershipResults, ...failed, ...skipped],
    };
  }

  logger.info("[GITHUB]", "Existing pending invitation not found");
  if (dryRun) {
    logger.info(
      "[GITHUB]",
      `DRY RUN would invite ${user.email} to teams ${desiredTeamIds.join(", ")}`,
    );
    return {
      provider: "GitHub",
      invitationCreated: true,
      mutated: true,
      githubLogin: knownLogin,
      invitationId: null,
      results: [
        ...teams.map((item) => ({ ...item, status: "pending", mutated: true })),
        ...failed,
        ...skipped,
      ],
    };
  }

  try {
    const invitation = await createOrgInvitation({
      email: user.email,
      teamIds: desiredTeamIds,
    });
    logger.info(
      "[GITHUB]",
      "The invited email must be verified on the recipient's GitHub account.",
    );
    return {
      provider: "GitHub",
      invitationCreated: true,
      mutated: true,
      githubLogin: invitation.login || knownLogin,
      invitationId: invitation.id,
      results: [
        ...teams.map((item) => ({
          ...item,
          status: "pending",
          invitationId: invitation.id,
          githubLogin: invitation.login || knownLogin,
          mutated: true,
        })),
        ...failed,
        ...skipped,
      ],
    };
  } catch (error) {
    if (isAlreadyInvitedError(error)) {
      const existing = await findPendingInvitationByEmail(user.email);
      logger.warn("[GITHUB]", `Invitation already exists for ${user.email}`);
      return {
        provider: "GitHub",
        invitationCreated: false,
        mutated: false,
        githubLogin: existing?.login || knownLogin,
        invitationId: existing?.id ?? null,
        results: [
          ...teams.map((item) => ({
            ...item,
            status: "pending",
            invitationId: existing?.id ?? null,
            githubLogin: existing?.login || knownLogin,
            mutated: false,
          })),
          ...failed,
          ...skipped,
        ],
      };
    }

    if (isAlreadyMemberError(error)) {
      const existingMember = await findMemberByEmail(user.email, knownLogin);
      if (existingMember) {
        const membershipResults = await ensureTeamMemberships(existingMember.login, teams, dryRun);
        return {
          provider: "GitHub",
          invitationCreated: false,
          mutated: membershipResults.some((item) => item.mutated),
          githubLogin: existingMember.login,
          invitationId: null,
          results: [...membershipResults, ...failed, ...skipped],
        };
      }
    }

    const message = formatGitHubError(error, user.email);
    logger.error("[ERROR]", message);
    return {
      provider: "GitHub",
      invitationCreated: false,
      mutated: false,
      githubLogin: knownLogin,
      invitationId: null,
      results: [
        ...teams.map((item) => ({ ...item, status: "failed", error: message, mutated: false })),
        ...failed,
        ...skipped,
      ],
    };
  }
}

export const githubProvider = {
  async reconcile(user, resources, context) {
    return reconcileGitHubAccess({ user, resources, ...context });
  },
  async provision(user, resources, context) {
    return reconcileGitHubAccess({ user, resources, ...context });
  },
  async revoke() {
    if (!allowsDestructiveRevocation()) {
      logger.info("[GITHUB]", "Skipping revocation (IAM_ENFORCEMENT_MODE=observe)");
      return { mutated: false, results: [] };
    }
    logger.info("[GITHUB]", "Revocation is not implemented in this phase");
    return { mutated: false, results: [] };
  },
};
