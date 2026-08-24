import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getDataSourceSchema } from "../notion/fields.js";
import { createSlackApp, registerSlackHandlers } from "../slack/index.js";

async function warmup() {
  getEnv();
  await Promise.all([
    getDataSourceSchema("users"),
    getDataSourceSchema("policies"),
    getDataSourceSchema("resources"),
    getDataSourceSchema("accessTracking"),
  ]);
}

async function main() {
  await warmup();
  const app = createSlackApp();
  registerSlackHandlers(app);
  await app.start();
  logger.info("[SLACK]", "Socket Mode onboarding bot is running");
}

main().catch((error) => {
  logger.error("[ERROR]", error.message);
  process.exitCode = 1;
});
