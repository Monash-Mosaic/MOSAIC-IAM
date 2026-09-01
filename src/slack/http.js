import { getSlackHttpEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  SLACK_ACTION_IDS,
  SLACK_COMMANDS,
  SLACK_UPDATE_VIEW_CALLBACK_ID,
  SLACK_VIEW_CALLBACK_ID,
} from "./config.js";
import {
  completeOnboarding,
  extractOnboardingSubmission,
  handleJoinInviteAction,
  modalValidationErrors,
  openOnboardingModal,
  openUpdateModal,
  sendWelcomeDm,
} from "./handlers.js";
import { SlackRequestError, readVerifiedSlackBody } from "./verify.js";
import { createSlackWebClient } from "./webClient.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function emptyAck() {
  return new Response("", { status: 200 });
}

function slackErrorResponse(error) {
  if (error instanceof SlackRequestError) {
    return jsonResponse(error.status, { error: error.message });
  }
  logger.error("[SLACK]", error?.message || "Unhandled Slack HTTP error");
  return jsonResponse(500, { error: "Internal error" });
}

function createClient() {
  return createSlackWebClient(getSlackHttpEnv().SLACK_BOT_TOKEN);
}

function schedule(ctx, work) {
  const promise = Promise.resolve()
    .then(work)
    .catch((error) => {
      logger.error("[SLACK]", error?.message || "Background Slack work failed");
    });
  if (ctx?.waitUntil) {
    ctx.waitUntil(promise);
    return;
  }
  return promise;
}

async function handleTeamJoin(event, ctx) {
  const client = createClient();
  schedule(ctx, () => sendWelcomeDm(client, event.user));
}

async function handleStartOnboarding(payload) {
  const client = createClient();
  try {
    await openOnboardingModal(client, payload);
  } catch (error) {
    logger.error("[SLACK]", `Failed to open onboarding modal: ${error.message}`);
  }
}

async function handleJoinInvite(payload, ctx) {
  const client = createClient();
  schedule(ctx, async () => {
    try {
      await handleJoinInviteAction(client, payload);
    } catch (error) {
      logger.error("[SLACK]", `Join invite action failed: ${error.message}`);
      try {
        await client.chat.postMessage({
          channel: payload.user?.id,
          text: "Sorry — we couldn't open that invite just then. Please try again, or message the MOSAIC team.",
        });
      } catch (dmError) {
        logger.error("[SLACK]", `Failed to send join invite failure DM: ${dmError.message}`);
      }
    }
  });
}

async function handleIamUpdateCommand(form) {
  const client = createClient();
  try {
    await openUpdateModal(client, {
      user_id: form.get("user_id"),
      trigger_id: form.get("trigger_id"),
      channel_id: form.get("channel_id"),
    });
  } catch (error) {
    logger.error("[SLACK]", `Failed to open update modal: ${error.message}`);
  }
}

async function handleDetailsSubmit(payload, ctx, intent) {
  const parsed = extractOnboardingSubmission(payload.view, payload.user?.id);
  const errors = await modalValidationErrors(parsed);
  if (errors) {
    return jsonResponse(200, { response_action: "errors", errors });
  }

  const client = createClient();
  const slackUserId = payload.user?.id;
  const label = intent === "update" ? "Profile update" : "Onboarding";
  schedule(ctx, async () => {
    try {
      await completeOnboarding(client, slackUserId, parsed, { intent });
    } catch (error) {
      logger.error("[SLACK]", `${label} submission failed: ${error.message}`);
      try {
        await client.chat.postMessage({
          channel: slackUserId,
          text:
            intent === "update"
              ? "Sorry — something went wrong while saving your details. Please try `/iam-update` again, or message the MOSAIC team if it keeps happening."
              : "Sorry — something went wrong while finishing onboarding. Please try again, or message the MOSAIC team if it keeps happening.",
        });
      } catch (dmError) {
        logger.error("[SLACK]", `Failed to send ${label.toLowerCase()} failure DM: ${dmError.message}`);
      }
    }
  });
  return emptyAck();
}

export async function handleSlackEvents(request, ctx) {
  try {
    const { SLACK_SIGNING_SECRET } = getSlackHttpEnv();
    const rawBody = await readVerifiedSlackBody(request, SLACK_SIGNING_SECRET);

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new SlackRequestError(400, "Malformed Slack request");
    }

    if (payload?.type === "url_verification") {
      if (typeof payload.challenge !== "string" || !payload.challenge) {
        throw new SlackRequestError(400, "Malformed Slack request");
      }
      return new Response(payload.challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (payload?.type === "event_callback" && payload.event?.type === "team_join") {
      await handleTeamJoin(payload.event, ctx);
    }

    return emptyAck();
  } catch (error) {
    return slackErrorResponse(error);
  }
}

export async function handleSlackCommands(request) {
  try {
    const { SLACK_SIGNING_SECRET } = getSlackHttpEnv();
    const rawBody = await readVerifiedSlackBody(request, SLACK_SIGNING_SECRET);
    const form = new URLSearchParams(rawBody);
    const command = form.get("command");

    if (command === SLACK_COMMANDS.iamUpdate) {
      await handleIamUpdateCommand(form);
    }

    return emptyAck();
  } catch (error) {
    return slackErrorResponse(error);
  }
}

export async function handleSlackInteractions(request, ctx) {
  try {
    const { SLACK_SIGNING_SECRET } = getSlackHttpEnv();
    const rawBody = await readVerifiedSlackBody(request, SLACK_SIGNING_SECRET);

    const form = new URLSearchParams(rawBody);
    const encodedPayload = form.get("payload");
    if (!encodedPayload) {
      throw new SlackRequestError(400, "Malformed Slack request");
    }

    let payload;
    try {
      payload = JSON.parse(encodedPayload);
    } catch {
      throw new SlackRequestError(400, "Malformed Slack request");
    }

    if (payload?.type === "block_actions") {
      const actionIds = (payload.actions ?? []).map((action) => action.action_id);
      if (actionIds.includes(SLACK_ACTION_IDS.startOnboarding)) {
        await handleStartOnboarding(payload);
      }
      if (actionIds.includes(SLACK_ACTION_IDS.joinInvite)) {
        await handleJoinInvite(payload, ctx);
      }
      return emptyAck();
    }

    if (payload?.type === "view_submission" && payload.view?.callback_id === SLACK_VIEW_CALLBACK_ID) {
      return handleDetailsSubmit(payload, ctx, "onboarding");
    }

    if (payload?.type === "view_submission" && payload.view?.callback_id === SLACK_UPDATE_VIEW_CALLBACK_ID) {
      return handleDetailsSubmit(payload, ctx, "update");
    }

    return emptyAck();
  } catch (error) {
    return slackErrorResponse(error);
  }
}
