import { allowsDestructiveRevocation } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  createOrgInvitation,
  findPendingInvitationByEmail,
  findUnexpiredPendingInvitationByEmail,
  formatGitHubError,
  isAlreadyInvitedError,
  isAlreadyMemberError,
} from "../github/invitations.js";
import {
  findTeamMemberByUsername,
  getOrgMembership,
  normalizeGithubLogin,
} from "../github/members.js";
import { addTeamMember, resolveTeam } from "../github/teams.js";

const MSG_INVITE_ALREADY_SENT = "invite already sent";
const MSG_ALREADY_A_MEMBER = "you are already a member";
const MSG_INVITE_SENT = "invite sent — check your email";

function uniqueTeamIds(ids) {
  return [...new Set(ids.map(Number).filter(Boolean))];
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

function knownGithubLogin(user) {
  return normalizeGithubLogin(user?.githubUsername);
}

export async function evaluateGitHubTeamAccess({
  user,
  team,
  knownLogin,
  pendingInvitation,
}) {
  const login = normalizeGithubLogin(knownLogin) || knownGithubLogin(user);

  const pending =
    pendingInvitation === undefined
      ? await findUnexpiredPendingInvitationByEmail(user.email)
      : pendingInvitation;
  if (pending) {
    logger.info(
      "[GITHUB]",
      `Unexpired pending invitation ${pending.id} found for ${user.email}`,
    );
    return {
      status: "pending",
      message: MSG_INVITE_ALREADY_SENT,
      invitationId: pending.id,
      githubLogin: pending.login || login,
      mutated: false,
    };
  }

  if (login) {
    const member = await findTeamMemberByUsername({
      teamSlug: team.slug,
      username: login,
    });
    if (member?.membership?.state === "active") {
      logger.info("[GITHUB]", `${member.login} is already a member of team ${team.slug}`);
      return {
        status: "active",
        message: MSG_ALREADY_A_MEMBER,
        invitationId: null,
        githubLogin: member.login,
        mutated: false,
      };
    }
    if (member?.membership?.state === "pending") {
      logger.info("[GITHUB]", `${member.login} has pending membership on team ${team.slug}`);
      return {
        status: "pending",
        message: MSG_INVITE_ALREADY_SENT,
        invitationId: null,
        githubLogin: member.login,
        mutated: false,
      };
    }
  } else {
    logger.info(
      "[GITHUB]",
      `No Github Username on Members row for ${user.email}; skipping team membership check`,
    );
  }

  return {
    status: "missing",
    message: "",
    invitationId: null,
    githubLogin: login,
    mutated: false,
  };
}

async function addExistingMemberToTeams(username, items, dryRun) {
  const results = [];
  for (const item of items) {
    try {
      if (dryRun) {
        logger.info("[GITHUB]", `DRY RUN would add ${username} to team ${item.team.slug}`);
        results.push({
          ...item,
          status: "active",
          message: MSG_ALREADY_A_MEMBER,
          githubLogin: username,
          mutated: true,
        });
        continue;
      }
      await addTeamMember({ teamSlug: item.team.slug, username });
      results.push({
        ...item,
        status: "active",
        message: MSG_ALREADY_A_MEMBER,
        githubLogin: username,
        mutated: true,
      });
    } catch (error) {
      const message = `GitHub team ${item.resource?.code || item.team?.slug} update failed: ${error.message}`;
      logger.error("[GITHUB]", message);
      results.push({
        ...item,
        status: "failed",
        error: message,
        githubLogin: username,
        mutated: false,
      });
    }
  }
  return results;
}

function pendingInviteResults(items, { invitationId, githubLogin, mutated, message }) {
  return items.map((item) => ({
    ...item,
    status: "pending",
    message: message || MSG_INVITE_ALREADY_SENT,
    invitationId: invitationId ?? null,
    githubLogin,
    mutated: Boolean(mutated),
  }));
}

export async function reconcileGitHubAccess({ user, resources, dryRun = false }) {
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
      githubLogin: knownGithubLogin(user),
      invitationId: null,
      results: [],
    };
  }

  const resolved = await resolveGitHubTeams(githubResources);
  const failed = resolved.filter((item) => item.status === "failed");
  const skipped = resolved.filter((item) => item.status === "skipped");
  const teams = resolved.filter((item) => item.status === "resolved");
  let knownLogin = knownGithubLogin(user);

  logger.info(
    "[IAM]",
    `Resource resolved: ${githubResources.map((resource) => resource.code).join(", ")}`,
  );
  if (knownLogin) {
    logger.info("[GITHUB]", `Using Github Username from Members: ${knownLogin}`);
  }

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

  const pendingInvitation = await findUnexpiredPendingInvitationByEmail(user.email);
  const evaluated = [];
  const needsInvite = [];
  for (const item of teams) {
    try {
      const access = await evaluateGitHubTeamAccess({
        user,
        team: item.team,
        knownLogin,
        pendingInvitation,
      });
      if (access.githubLogin) {
        knownLogin = access.githubLogin;
      }
      if (access.status === "missing") {
        needsInvite.push(item);
        continue;
      }
      evaluated.push({
        ...item,
        ...access,
      });
    } catch (error) {
      const message = `GitHub team ${item.resource?.code || item.team?.slug} lookup failed: ${error.message}`;
      logger.error("[GITHUB]", message);
      evaluated.push({
        ...item,
        status: "failed",
        error: message,
        mutated: false,
      });
    }
  }

  if (!needsInvite.length) {
    return {
      provider: "GitHub",
      invitationCreated: false,
      mutated: evaluated.some((item) => item.mutated),
      githubLogin: knownLogin,
      invitationId: evaluated.find((item) => item.invitationId)?.invitationId ?? null,
      results: [...evaluated, ...failed, ...skipped],
    };
  }

  const desiredTeamIds = uniqueTeamIds(needsInvite.map((item) => item.team.id));

  if (knownLogin) {
    const orgMembership = await getOrgMembership(knownLogin);
    if (orgMembership?.state === "active") {
      logger.info(
        "[GITHUB]",
        `${knownLogin} is already an organisation member; adding to team(s)`,
      );
      const membershipResults = await addExistingMemberToTeams(knownLogin, needsInvite, dryRun);
      return {
        provider: "GitHub",
        invitationCreated: false,
        mutated: membershipResults.some((item) => item.mutated),
        githubLogin: knownLogin,
        invitationId: null,
        results: [...evaluated, ...membershipResults, ...failed, ...skipped],
      };
    }
  }

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
        ...evaluated,
        ...pendingInviteResults(needsInvite, {
          githubLogin: knownLogin,
          mutated: true,
          message: MSG_INVITE_SENT,
        }),
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
    const refreshedLogin = invitation.login || knownLogin;
    logger.info(
      "[GITHUB]",
      "The invited email must be verified on the recipient's GitHub account.",
    );
    return {
      provider: "GitHub",
      invitationCreated: true,
      mutated: true,
      githubLogin: refreshedLogin,
      invitationId: invitation.id,
      results: [
        ...evaluated,
        ...pendingInviteResults(needsInvite, {
          invitationId: invitation.id,
          githubLogin: refreshedLogin,
          mutated: true,
          message: MSG_INVITE_SENT,
        }),
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
          ...evaluated,
          ...pendingInviteResults(needsInvite, {
            invitationId: existing?.id ?? null,
            githubLogin: existing?.login || knownLogin,
            mutated: false,
            message: MSG_INVITE_ALREADY_SENT,
          }),
          ...failed,
          ...skipped,
        ],
      };
    }

    if (isAlreadyMemberError(error) && knownLogin) {
      const membershipResults = await addExistingMemberToTeams(knownLogin, needsInvite, dryRun);
      return {
        provider: "GitHub",
        invitationCreated: false,
        mutated: membershipResults.some((item) => item.mutated),
        githubLogin: knownLogin,
        invitationId: null,
        results: [...evaluated, ...membershipResults, ...failed, ...skipped],
      };
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
        ...evaluated,
        ...needsInvite.map((item) => ({
          ...item,
          status: "failed",
          error: message,
          mutated: false,
        })),
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
