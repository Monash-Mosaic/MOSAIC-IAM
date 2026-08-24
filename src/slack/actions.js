import { logger } from "../utils/logger.js";
import { SLACK_ACTION_IDS, SLACK_VIEW_CALLBACK_ID } from "./config.js";
import {
  completeOnboarding,
  extractOnboardingSubmission,
  modalValidationErrors,
  openOnboardingModal,
} from "./handlers.js";

export function registerActions(app) {
  app.action(SLACK_ACTION_IDS.startOnboarding, async ({ ack, body, client }) => {
    await ack();
    try {
      await openOnboardingModal(client, body);
    } catch (error) {
      logger.error("[SLACK]", `Failed to open onboarding modal: ${error.message}`);
    }
  });

  app.view(SLACK_VIEW_CALLBACK_ID, async ({ ack, body, view, client }) => {
    const parsed = extractOnboardingSubmission(view, body.user?.id);
    const errors = await modalValidationErrors(parsed);
    if (errors) {
      await ack({ response_action: "errors", errors });
      return;
    }

    await ack();
    try {
      await completeOnboarding(client, body.user.id, parsed);
    } catch (error) {
      logger.error("[SLACK]", `Onboarding submission failed: ${error.message}`);
      try {
        await client.chat.postMessage({
          channel: body.user.id,
          text: "Sorry — something went wrong while finishing onboarding. Please try again, or message the MOSAIC team if it keeps happening.",
        });
      } catch (dmError) {
        logger.error("[SLACK]", `Failed to send onboarding failure DM: ${dmError.message}`);
      }
    }
  });
}
