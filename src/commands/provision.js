import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getGitHubClient } from "../github/client.js";
import { getActiveUsers, getUserByEmail } from "../notion/users.js";
import { getDataSourceSchema } from "../notion/fields.js";
import { reconcileUser } from "../iam/reconciler.js";

function parseArgs(argv) {
  const args = {
    dryRun: false,
    email: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--email") {
      args.email = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return args;
}

async function loadUsers(email) {
  if (email) {
    const user = await getUserByEmail(email);
    if (!user) {
      throw new Error(`No active IAM user found for ${email}`);
    }
    return [user];
  }
  return getActiveUsers();
}

async function warmup() {
  getEnv();
  await Promise.all([
    getDataSourceSchema("users"),
    getDataSourceSchema("policies"),
    getDataSourceSchema("resources"),
  ]);
  await getGitHubClient();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logger.info("[IAM]", args.dryRun ? "IAM reconciliation started (DRY RUN)" : "IAM reconciliation started");
  await warmup();

  const users = await loadUsers(args.email);
  logger.info("[IAM]", `Found ${users.length} active user(s) requiring reconciliation`);

  const summary = {
    processed: 0,
    invitationsCreated: 0,
    pending: 0,
    active: 0,
    failed: 0,
  };

  for (const user of users) {
    summary.processed += 1;
    try {
      const result = await reconcileUser(user, { dryRun: args.dryRun });
      if (result.invitationCreated) {
        summary.invitationsCreated += 1;
      }
      for (const item of result.results) {
        const status = String(item.status).toLowerCase();
        if (status === "pending") {
          summary.pending += 1;
        } else if (status === "active") {
          summary.active += 1;
        } else if (status === "failed") {
          summary.failed += 1;
        }
      }
      if (result.error) {
        logger.error("[ERROR]", result.error);
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      logger.error("[ERROR]", `Failed to reconcile ${user.email}: ${error.message}`);
    }
  }

  logger.info(
    "[IAM]",
    `Summary: users=${summary.processed} invitations=${summary.invitationsCreated} pending=${summary.pending} active=${summary.active} failed=${summary.failed}`,
  );
}

main().catch((error) => {
  logger.error("[ERROR]", error.message);
  process.exitCode = 1;
});
