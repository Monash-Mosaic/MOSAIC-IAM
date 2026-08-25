import { logger } from "../utils/logger.js";
import { bootstrapGitHub } from "./bootstrapGitHub.js";
import { bootstrapSlack } from "./bootstrapSlack.js";

function printSummary({ slack, github, dryRun }) {
  const userMutations = slack ? slack.created + slack.updated : 0;
  const trackingMutations = github ? github.trackingTotal : 0;

  logger.info("[SLACK]", slack ? `Found ${slack.found} active users` : "Skipped");
  if (slack) {
    logger.info("[SLACK]", `Mapped ${slack.mapped} emails to Slack IDs`);
  }
  logger.info("[GITHUB]", github ? `Found ${github.orgMembers} organisation members` : "Skipped");
  if (github) {
    logger.info("[GITHUB]", `Scanning ${github.teamsScanned} IAM-managed teams`);
    logger.info("[GITHUB]", `Mapped automatically: ${github.mappedAutomatically}`);
    logger.info("[GITHUB]", `Unresolved identities: ${github.unresolved}`);
    if (github.unmappedTracking) {
      logger.info(
        "[GITHUB]",
        `${github.unmappedTracking} tracking row(s) need a manual Users assignment`,
      );
    }
  }
  logger.info("[IMPORT]", `${dryRun ? "Would create/update" : "Created/updated"} ${userMutations} IAM users`);
  logger.info(
    "[IMPORT]",
    `${dryRun ? "Would create/update" : "Created/updated"} ${trackingMutations} Access Tracking records`,
  );
  logger.info("[IMPORT]", "No provider mutations performed.");
}

export async function runBootstrap({ target = "all", dryRun = false } = {}) {
  if (dryRun) {
    logger.info("[BOOTSTRAP]", "DRY RUN: discovery and matching only; Notion will not be written");
  } else {
    logger.info("[BOOTSTRAP]", "Importing provider state into Notion only (no Slack/GitHub mutations)");
  }

  let slack = null;
  let github = null;

  if (target === "slack" || target === "all") {
    slack = await bootstrapSlack({ dryRun });
  }
  if (target === "github" || target === "all") {
    github = await bootstrapGitHub({
      dryRun,
      knownUsers: slack?.users ?? [],
    });
  }

  printSummary({ slack, github, dryRun });
  return { slack, github, dryRun };
}
