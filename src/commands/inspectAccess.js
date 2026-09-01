import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getDataSourceSchema } from "../notion/fields.js";
import {
  formatInspectAccessReport,
  inspectAccessBySlackId,
} from "../iam/inspectAccess.js";

function parseArgs(argv) {
  const args = {
    slackId: null,
    reconcile: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--slack-id" || arg === "--slackId") {
      args.slackId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--reconcile") {
      args.reconcile = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
}

async function warmup() {
  getEnv();
  await Promise.all([
    getDataSourceSchema("users"),
    getDataSourceSchema("policies"),
    getDataSourceSchema("resources"),
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.slackId) {
    console.log(`Usage:
  npm run inspect:access -- --slack-id U0123456789
  npm run inspect:access -- --slack-id U0123456789 --reconcile

Looks up the IAM user by Slack ID, compares RBAC desired access to live
GitHub team invitations/membership and Notion/Figma invite links, and optionally
runs a reconcile dry-run (no writes).`);
    if (!args.slackId && !args.help) {
      process.exitCode = 1;
    }
    return;
  }

  await warmup();
  const report = await inspectAccessBySlackId(args.slackId, {
    reconcile: args.reconcile,
  });
  console.log(formatInspectAccessReport(report));
}

main().catch((error) => {
  logger.error("[ERROR]", error.message);
  process.exitCode = 1;
});
