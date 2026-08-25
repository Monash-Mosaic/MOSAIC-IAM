import { logger } from "../utils/logger.js";
import { validateOnboardingInput, onboardingService } from "../iam/onboarding.js";
import { getUserSelectOptions } from "../notion/userOptions.js";
import { findUserBySlackId } from "../notion/users.js";
import { buildOnboardingResultBlocks } from "../iam/accessSummary.js";
import { SLACK_BLOCK_IDS } from "./config.js";
import { buildOnboardingModal, buildUpdateModal, buildWelcomeBlocks, parseOnboardingModal } from "./modals.js";

function isIgnorableUser(user) {
  if (!user || typeof user !== "object") {
    return true;
  }
  return Boolean(user.is_bot || user.deleted || user.id === "USLACKBOT");
}

function slackUserIdFromBody(body) {
  return body?.user?.id || body?.user_id || "";
}

function slackProfilePrefill(member) {
  if (!member || typeof member !== "object") {
    return {};
  }
  return {
    name:
      member.profile?.real_name?.trim() ||
      member.real_name?.trim() ||
      member.profile?.display_name?.trim() ||
      member.name?.trim() ||
      "",
    email: String(member.profile?.email ?? "").trim().toLowerCase(),
  };
}

async function loadUpdatePrefill(client, slackUserId) {
  const iamUser = await findUserBySlackId(slackUserId);
  if (iamUser) {
    return {
      found: true,
      pageId: iamUser.pageId,
      prefill: {
        name: iamUser.name,
        email: iamUser.email,
        department: iamUser.department,
        role: iamUser.role,
      },
    };
  }

  let profile = {};
  try {
    const info = await client.users.info({ user: slackUserId });
    profile = slackProfilePrefill(info.user);
  } catch (error) {
    logger.warn("[SLACK]", `Could not load Slack profile for ${slackUserId}: ${error.message}`);
  }

  return {
    found: false,
    pageId: "",
    prefill: {
      name: profile.name || "",
      email: profile.email || "",
      department: "",
      role: "",
    },
  };
}

export async function sendWelcomeDm(client, user) {
  if (isIgnorableUser(user)) {
    logger.info("[SLACK]", "Ignoring bot or service user join");
    return;
  }

  await client.chat.postMessage({
    channel: user.id,
    text: "Hey, welcome to MOSAIC! Tap Get started and we'll set up your access.",
    blocks: buildWelcomeBlocks(),
  });
  logger.info("[SLACK]", `Sent onboarding welcome DM to ${user.id}`);
}

export async function openOnboardingModal(client, body) {
  const slackUserId = slackUserIdFromBody(body);
  try {
    const options = await getUserSelectOptions();
    if (!options.departments.length || !options.roles.length) {
      throw new Error("Department or Role options are not configured in Notion");
    }
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildOnboardingModal({ slackUserId, options }),
    });
  } catch (error) {
    logger.error("[SLACK]", `Could not load onboarding options: ${error.message}`);
    await client.chat.postMessage({
      channel: slackUserId,
      text: "Onboarding is taking a short break. Please try again in a moment, or message the MOSAIC team if it keeps happening.",
    });
  }
}

export async function openUpdateModal(client, body) {
  const slackUserId = slackUserIdFromBody(body);
  try {
    const [options, details] = await Promise.all([
      getUserSelectOptions(),
      loadUpdatePrefill(client, slackUserId),
    ]);
    if (!options.departments.length || !options.roles.length) {
      throw new Error("Department or Role options are not configured in Notion");
    }
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildUpdateModal({
        slackUserId,
        pageId: details.pageId,
        found: details.found,
        prefill: details.prefill,
        options,
      }),
    });
  } catch (error) {
    logger.error("[SLACK]", `Could not open update modal: ${error.message}`);
    try {
      await client.chat.postMessage({
        channel: slackUserId,
        text: "We couldn't open your MOSAIC details just then. Please try `/iam-update` again in a moment, or message the MOSAIC team if it keeps happening.",
      });
    } catch (dmError) {
      logger.error("[SLACK]", `Failed to send update modal failure DM: ${dmError.message}`);
    }
  }
}

export async function modalValidationErrors(parsed) {
  const errors = await validateOnboardingInput(parsed);
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

export async function completeOnboarding(client, slackUserId, input, { intent = "onboarding" } = {}) {
  const result = await onboardingService(
    {
      ...input,
      slackUserId,
    },
    { intent },
  );
  await client.chat.postMessage({
    channel: slackUserId,
    text: result.message,
    blocks: result.outcome === "failed" ? undefined : buildOnboardingResultBlocks(result),
  });
  logger.info("[SLACK]", `${intent === "update" ? "Profile update" : "Onboarding"} ${result.outcome} for Slack user ${slackUserId}`);
  return result;
}
