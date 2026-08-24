import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getDataSourceSchema } from "../notion/fields.js";
import { onboardingService } from "../iam/onboarding.js";

function readFlagValue(argv, startIndex) {
  const parts = [];
  let index = startIndex + 1;
  while (index < argv.length && !argv[index].startsWith("--")) {
    parts.push(argv[index]);
    index += 1;
  }
  return { value: parts.join(" ") || null, nextIndex: index - 1 };
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    name: null,
    email: null,
    department: null,
    role: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--name" || arg === "--email" || arg === "--department" || arg === "--role") {
      const key = arg.slice(2);
      const result = readFlagValue(argv, index);
      args[key] = result.value;
      index = result.nextIndex;
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
    getDataSourceSchema("accessTracking"),
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name || !args.email || !args.department || !args.role) {
    throw new Error(
      'Usage: npm run demo:onboarding -- --name "Test User" --email test@example.com --department Engineering --role Developer [--dry-run]',
    );
  }

  logger.info(
    "[IAM]",
    args.dryRun ? "Demo onboarding started (DRY RUN)" : "Demo onboarding started",
  );
  await warmup();

  const result = await onboardingService(
    {
      name: args.name,
      email: args.email,
      department: args.department,
      role: args.role,
    },
    { dryRun: args.dryRun },
  );

  logger.info("[IAM]", result.message.split("\n").join(" | "));
  logger.info(
    "[IAM]",
    `Outcome=${result.outcome} saved=${result.saved} provisioningStatus=${result.reconcileResult?.provisioningStatus ?? "n/a"} invitationCreated=${Boolean(result.reconcileResult?.invitationCreated)}`,
  );

  if (result.outcome === "failed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  logger.error("[ERROR]", error.message);
  process.exitCode = 1;
});
