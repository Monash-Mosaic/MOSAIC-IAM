import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { getEnv, getGitHubPrivateKey } from "../config/env.js";
import { logger } from "../utils/logger.js";

let octokit;

export async function getGitHubClient() {
  if (octokit) {
    return octokit;
  }

  const env = getEnv();
  octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: env.GITHUB_APP_ID,
      privateKey: getGitHubPrivateKey(),
      installationId: env.GITHUB_INSTALLATION_ID,
    },
  });

  logger.info("[GITHUB]", `Authenticated GitHub App installation ${env.GITHUB_INSTALLATION_ID}`);
  return octokit;
}
