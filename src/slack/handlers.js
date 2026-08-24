import { logger } from "../utils/logger.js";
import { validateOnboardingInput, onboardingService } from "../iam/onboarding.js";
import { SLACK_BLOCK_IDS } from "./config.js";
import { buildOnboardingModal, buildWelcomeBlocks, parseOnboardingModal } from "./modals.js";

function isIgnorableUser(user) {
  if (!user || typeof user !== "object") {
    return true;
  }
  return Boolean(user.is_bot || user.deleted || user.id === "USLACKBOT");
}

export async function sendWelcomeDm(client, user) {
  if (isIgnorableUser(user)) {
    logger.info("[SLACK]", "Ignoring bot or service user join");
    return;
  }

  await client.chat.postMessage({
    channel: user.id,
    text: "Welcome to MOSAIC. Click Start Onboarding to continue.",
    blocks: buildWelcomeBlocks(),
  });
  logger.info("[SLACK]", `Sent onboarding welcome DM to ${user.id}`);
}

export async function openOnboardingModal(client, body) {
  const slackUserId = body.user?.id;
  await client.views.open({
    trigger_id: body.trigger_id,
    view: buildOnboardingModal({ slackUserId }),
  });
}

export function modalValidationErrors(parsed) {
  const errors = validateOnboardingInput(parsed);
  if (!Object.keys(errors).length) {
    return null;
  }
  const mapped = {};
  if (errors.name) {
    mapped[SLACK_BLOCK_IDS.name] = errors.name;
  }
  if (errors.email) {
    mapped[SLACK_BLOCK_IDS.email] = errors.email;
  }
  if (errors.department) {
    mapped[SLACK_BLOCK_IDS.department] = errors.department;
  }
  if (errors.role) {
    mapped[SLACK_BLOCK_IDS.role] = errors.role;
  }
  return mapped;
}

export function extractOnboardingSubmission(view, slackUserId) {
  const parsed = parseOnboardingModal(view);
  return {
    ...parsed,
    slackUserId: parsed.slackUserId || slackUserId || "",
  };
}

export async function completeOnboarding(client, slackUserId, input) {
  const result = await onboardingService({
    ...input,
    slackUserId,
  });
  await client.chat.postMessage({
    channel: slackUserId,
    text: result.message,
  });
  logger.info("[SLACK]", `Onboarding ${result.outcome} for Slack user ${slackUserId}`);
  return result;
}
