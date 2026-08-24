import { logger } from "../utils/logger.js";
import { sendWelcomeDm } from "./handlers.js";

export function registerEvents(app) {
  app.event("team_join", async ({ event, client }) => {
    try {
      await sendWelcomeDm(client, event.user);
    } catch (error) {
      logger.error("[SLACK]", `Failed to send onboarding DM: ${error.message}`);
    }
  });
}
