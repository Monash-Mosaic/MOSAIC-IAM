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
} from "./handlers.js";

async function handleDetailsSubmit({ ack, body, view, client, intent }) {
  const parsed = extractOnboardingSubmission(view, body.user?.id);
  const errors = await modalValidationErrors(parsed);
  if (errors) {
    await ack({ response_action: "errors", errors });
    return;
  }

  await ack();
  const label = intent === "update" ? "Profile update" : "Onboarding";
  try {
    await completeOnboarding(client, body.user.id, parsed, { intent });
  } catch (error) {
    logger.error("[SLACK]", `${label} submission failed: ${error.message}`);
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text:
          intent === "update"
            ? "Sorry — something went wrong while saving your details. Please try `/iam-update` again, or message the MOSAIC team if it keeps happening."
            : "Sorry — something went wrong while finishing onboarding. Please try again, or message the MOSAIC team if it keeps happening.",
      });
    } catch (dmError) {
      logger.error("[SLACK]", `Failed to send ${label.toLowerCase()} failure DM: ${dmError.message}`);
    }
  }
}

export function registerActions(app) {
  app.command(SLACK_COMMANDS.iamUpdate, async ({ ack, body, client }) => {
    await ack();
    try {
      await openUpdateModal(client, body);
    } catch (error) {
      logger.error("[SLACK]", `Failed to open update modal: ${error.message}`);
    }
  });

  app.action(SLACK_ACTION_IDS.startOnboarding, async ({ ack, body, client }) => {
    await ack();
    try {
      await openOnboardingModal(client, body);
    } catch (error) {
      logger.error("[SLACK]", `Failed to open onboarding modal: ${error.message}`);
    }
  });

  app.action(SLACK_ACTION_IDS.joinInvite, async ({ ack, body, client }) => {
    await ack();
    try {
      await handleJoinInviteAction(client, body);
    } catch (error) {
      logger.error("[SLACK]", `Join invite action failed: ${error.message}`);
      try {
        await client.chat.postMessage({
          channel: body.user?.id,
          text: "Sorry — we couldn't record that join just then. Please try again, or message the MOSAIC team.",
        });
      } catch (dmError) {
        logger.error("[SLACK]", `Failed to send join invite failure DM: ${dmError.message}`);
      }
    }
  });

  app.view(SLACK_VIEW_CALLBACK_ID, async ({ ack, body, view, client }) => {
    await handleDetailsSubmit({ ack, body, view, client, intent: "onboarding" });
  });

  app.view(SLACK_UPDATE_VIEW_CALLBACK_ID, async ({ ack, body, view, client }) => {
    await handleDetailsSubmit({ ack, body, view, client, intent: "update" });
  });
}
