import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "./client.js";
import { githubErrorText, isAlreadyInvitedError, isAlreadyMemberError } from "./errors.js";

export { githubErrorText, isAlreadyInvitedError, isAlreadyMemberError };

export async function listPendingInvitations() {
  const env = getEnv();
  const octokit = await getGitHubClient();
  return octokit.paginate(octokit.rest.orgs.listPendingInvitations, {
    org: env.GH_ORG,
    per_page: 100,
  });
}

export async function findPendingInvitationByEmail(email) {
  const invitations = await listPendingInvitations();
  const normalized = email.trim().toLowerCase();
  return (
    invitations.find((invitation) => invitation.email?.trim().toLowerCase() === normalized) ?? null
  );
}

export async function getInvitationTeams(invitationId) {
  const env = getEnv();
  const octokit = await getGitHubClient();
  return octokit.paginate(octokit.rest.orgs.listInvitationTeams, {
    org: env.GH_ORG,
    invitation_id: invitationId,
    per_page: 100,
  });
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

export async function cancelOrgInvitation(invitationId) {
  const env = getEnv();
  const octokit = await getGitHubClient();
  logger.warn("[GITHUB]", `Cancelling pending organisation invitation ${invitationId}`);
  await octokit.rest.orgs.cancelInvitation({
    org: env.GH_ORG,
    invitation_id: invitationId,
  });
}

export function formatGitHubError(error, email) {
  const status = error.status ?? "unknown";
  const message = githubErrorText(error) || error.message;
  return `GitHub invitation failed for ${email}: ${status} ${message}`;
}
