import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "./client.js";

let teamCache;

export async function listOrgTeams() {
  if (teamCache) {
    return teamCache;
  }
  const env = getEnv();
  const octokit = await getGitHubClient();
  teamCache = await octokit.paginate(octokit.rest.teams.list, {
    org: env.GITHUB_ORG,
    per_page: 100,
  });
  return teamCache;
}

export async function getTeamById(teamId) {
  const octokit = await getGitHubClient();
  const { data } = await octokit.rest.teams.getById({
    team_id: Number(teamId),
  });
  return data;
}

export async function resolveTeam({ externalResourceId, externalName, code }) {
  const teamId = externalResourceId;
  if (teamId) {
    try {
      return await getTeamById(teamId);
    } catch (error) {
      logger.warn(
        "[GITHUB]",
        `Could not load GitHub team ${teamId} for ${code}: ${error.message}`,
      );
    }
  }

  if (!externalName) {
    return null;
  }

  const teams = await listOrgTeams();
  const normalized = externalName.trim().toLowerCase();
  return (
    teams.find(
      (team) =>
        team.name.toLowerCase() === normalized ||
        team.slug.toLowerCase() === normalized ||
        team.slug.toLowerCase() === normalized.replace(/\s+/g, "-"),
    ) ?? null
  );
}

export async function listTeamMembers({ teamSlug }) {
  const env = getEnv();
  const octokit = await getGitHubClient();
  return octokit.paginate(octokit.rest.teams.listMembersInOrg, {
    org: env.GITHUB_ORG,
    team_slug: teamSlug,
    per_page: 100,
  });
}

export async function isTeamMember({ teamSlug, username }) {
  const env = getEnv();
  const octokit = await getGitHubClient();
  try {
    const { data } = await octokit.rest.teams.getMembershipForUserInOrg({
      org: env.GITHUB_ORG,
      team_slug: teamSlug,
      username,
    });
    return data.state === "active" || data.state === "pending";
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}

export async function addTeamMember({ teamSlug, username }) {
  const env = getEnv();
  const octokit = await getGitHubClient();
  const { data } = await octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
    org: env.GITHUB_ORG,
    team_slug: teamSlug,
    username,
    role: "member",
  });
  return data;
}
