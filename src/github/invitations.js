import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "./client.js";
import { githubErrorText, isAlreadyInvitedError, isAlreadyMemberError } from "./errors.js";

export { githubErrorText, isAlreadyInvitedError, isAlreadyMemberError };

/** GitHub organisation invitations expire 7 days after they are created. */
const GITHUB_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function listPendingInvitations() {
  const env = getEnv();
  const octokit = await getGitHubClient();
  return octokit.paginate(octokit.rest.orgs.listPendingInvitations, {
    org: env.GH_ORG,
    per_page: 100,
  });
}

export function isInvitationExpired(invitation) {
  if (!invitation) {
    return true;
  }
  if (invitation.expired === true || invitation.invitation_expired === true) {
    return true;
  }
  if (invitation.failed_at) {
    return true;
  }
  const createdAt = invitation.created_at ? Date.parse(invitation.created_at) : NaN;
  if (!Number.isFinite(createdAt)) {
    return false;
  }
  return Date.now() - createdAt > GITHUB_INVITE_TTL_MS;
}

export async function findPendingInvitationByEmail(email) {
  const invitations = await listPendingInvitations();
  const normalized = String(email ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }
  return (
    invitations.find((invitation) => invitation.email?.trim().toLowerCase() === normalized) ?? null
  );
}

export async function findUnexpiredPendingInvitationByEmail(email) {
  const invitation = await findPendingInvitationByEmail(email);
  if (!invitation) {
    return null;
  }
  if (isInvitationExpired(invitation)) {
    logger.info(
      "[GITHUB]",
      `Pending invitation ${invitation.id} for ${email} is expired; treating as not sent`,
    );
    return null;
  }
  return invitation;
}

export async function createOrgInvitation({ email, teamIds }) {
  const env = getEnv();
  const octokit = await getGitHubClient();
  const uniqueTeamIds = [...new Set(teamIds.map(Number).filter(Boolean))];
  logger.info(
    "[GITHUB]",
    `Creating organisation invitation for ${email} with team IDs: ${uniqueTeamIds.join(", ") || "(none)"}`,
  );
  const { data } = await octokit.rest.orgs.createInvitation({
    org: env.GH_ORG,
    email,
    role: "direct_member",
    team_ids: uniqueTeamIds,
  });
  return data;
}

export function formatGitHubError(error, email) {
  const status = error.status ?? "unknown";
  const message = githubErrorText(error) || error.message;
  return `GitHub invitation failed for ${email}: ${status} ${message}`;
}
