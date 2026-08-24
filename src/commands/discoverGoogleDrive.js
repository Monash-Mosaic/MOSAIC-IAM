import { logger } from "../utils/logger.js";
import { isGoogleConfigured } from "../config/env.js";
import { listAccessibleFolders, listSharedDrives } from "../google/drive.js";

async function main() {
  if (!isGoogleConfigured()) {
    logger.info("[GOOGLE]", "GoogleDrive not configured.");
    logger.info(
      "[GOOGLE]",
      "Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN, then re-run npm run discover:google-drive.",
    );
    return;
  }

  const [drives, folders] = await Promise.all([listSharedDrives(), listAccessibleFolders()]);
  logger.info("[GOOGLE]", `Shared drives (${drives.length}):`);
  for (const drive of drives) {
    logger.info("[GOOGLE]", `- ${drive.name} | ${drive.id}`);
  }
  logger.info("[GOOGLE]", `Folders (${folders.length}, first page):`);
  for (const folder of folders) {
    logger.info("[GOOGLE]", `- ${folder.name} | ${folder.id}`);
  }
}

main().catch((error) => {
  logger.error("[ERROR]", error.message);
  process.exitCode = 1;
});
