import { logger } from "../utils/logger.js";
import { validateOnboardingInput, onboardingService } from "../iam/onboarding.js";
import {
  decodeInviteActionValue,
  resolveInviteLink,
} from "../iam/inviteLinks.js";
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
    mobile: String(member.profile?.phone ?? "").trim(),
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
        mobile: iamUser.mobile || "",
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
      mobile: profile.mobile || "",
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
    const [options, details] = await Promise.all([
      getUserSelectOptions(),
      loadUpdatePrefill(client, slackUserId),
    ]);
    if (!options.departments.length || !options.roles.length) {
      throw new Error("Department or Role options are not configured in Notion");
    }
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildOnboardingModal({
        slackUserId,
        prefill: details.prefill,
        options,
      }),
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
  if (errors.mobile) {
    mapped[SLACK_BLOCK_IDS.mobile] = errors.mobile;
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
  const text = result.message;
  const blocks = result.outcome === "failed" ? undefined : buildOnboardingResultBlocks(result);
  try {
    await client.chat.postMessage({
      channel: slackUserId,
      text,
      blocks,
    });
  } catch (error) {
    if (blocks) {
      logger.warn(
        "[SLACK]",
        `Block Kit onboarding DM failed (${error.message}); sending text-only fallback`,
      );
      await client.chat.postMessage({
        channel: slackUserId,
        text,
      });
    } else {
      throw error;
    }
  }
  logger.info("[SLACK]", `${intent === "update" ? "Profile update" : "Onboarding"} ${result.outcome} for Slack user ${slackUserId}`);
  return result;
}

export async function handleJoinInviteAction(client, body) {
  const action = body?.actions?.[0];
  const slackUserId = body?.user?.id;
  const decoded = decodeInviteActionValue(action?.value);
  if (!slackUserId || !decoded) {
    throw new Error("Join invite action is missing Slack user or invite details");
  }

  const joined = await resolveInviteLink({
    slackUserId,
    resourceCode: decoded.code,
    inviteUrl: decoded.inviteUrl,
  });

  const label =
    decoded.provider === "figma"
      ? "Figma"
      : decoded.provider === "notion"
        ? "Notion"
        : joined.resource?.externalName || decoded.code;

  await client.chat.postMessage({
    channel: slackUserId,
    text: `Here's your ${label} invite. Join with the link if you haven't already — otherwise you can ignore it: ${joined.inviteUrl}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Join *${label}* with the link if you haven't already — otherwise you can ignore it.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: `Open ${label}` },
            url: joined.inviteUrl,
            style: "primary",
          },
        ],
      },
    ],
  });

  logger.info(
    "[SLACK]",
    `Shared ${decoded.code} invite link with Slack user ${slackUserId}`,
  );
  return joined;
}
