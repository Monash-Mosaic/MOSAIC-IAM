import { logger } from "../utils/logger.js";
import { getGoogleEnv } from "../config/env.js";
import { runInteractiveGoogleAuth } from "../google/oauth.js";

async function main() {
  const google = getGoogleEnv();
  if (!google.clientId || !google.clientSecret) {
    throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before running npm run google:auth");
  }

  logger.info("[GOOGLE]", "Starting Google OAuth consent for Drive access");
  logger.info("[GOOGLE]", `Redirect URI must be allowed in Google Cloud: ${google.redirectUri}`);
  const tokens = await runInteractiveGoogleAuth();

  logger.info("[GOOGLE]", "Authorization succeeded. Add this refresh token to .env (do not commit it):");
  logger.info("[GOOGLE]", `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  logger.info("[GOOGLE]", "This command does not write secrets to disk.");
}

main().catch((error) => {
  logger.error("[ERROR]", error.message);
  process.exitCode = 1;
});
