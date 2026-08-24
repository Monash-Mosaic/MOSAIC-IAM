import { logger } from "../utils/logger.js";
import { createSlackApp } from "../slack/client.js";
import { sendWelcomeDm } from "../slack/handlers.js";

function parseArgs(argv) {
  let userId = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--user") {
      userId = argv[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--user=")) {
      userId = arg.slice("--user=".length) || null;
    }
  }
  return { userId: userId?.trim() || null };
}

async function main() {
  const { userId } = parseArgs(process.argv.slice(2));
  if (!userId) {
    throw new Error("Usage: npm run slack:test-dm -- --user U0123456789");
  }

  const app = createSlackApp();
  const info = await app.client.users.info({ user: userId });
  if (!info.ok || !info.user) {
    throw new Error(`Slack user not found: ${userId}`);
  }

  await sendWelcomeDm(app.client, info.user);
  logger.info("[SLACK]", `Test onboarding DM sent to ${userId}`);
}

main().catch((error) => {
  logger.error("[ERROR]", error.message);
  process.exitCode = 1;
});
