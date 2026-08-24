import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "../github/client.js";
import { getDataSourceSchema } from "../notion/fields.js";
import { runBootstrap } from "../iam/bootstrap.js";

function parseArgs(argv) {
  const args = {
    target: "all",
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "slack" || arg === "github" || arg === "all") {
      args.target = arg;
    }
  }
  return args;
}

async function warmup(target) {
  getEnv();
  const schemas = [getDataSourceSchema("users"), getDataSourceSchema("accessTracking")];
  if (target === "github" || target === "all") {
    schemas.push(getDataSourceSchema("resources"));
    await getGitHubClient();
  }
  await Promise.all(schemas);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await warmup(args.target);
  await runBootstrap(args);
}

main().catch((error) => {
  logger.error("[ERROR]", error.message);
  process.exitCode = 1;
});
