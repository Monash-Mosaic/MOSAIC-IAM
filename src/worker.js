import { applyWorkerBindings } from "./config/env.js";
import {
  handleSlackCommands,
  handleSlackEvents,
  handleSlackInteractions,
} from "./slack/http.js";
import { logger } from "./utils/logger.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      applyWorkerBindings(env);
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        if (request.method !== "GET") {
          return jsonResponse(405, { error: "Method not allowed" });
        }
        return jsonResponse(200, { status: "ok" });
      }

      if (url.pathname === "/slack/events") {
        if (request.method !== "POST") {
          return jsonResponse(405, { error: "Method not allowed" });
        }
        return handleSlackEvents(request, ctx);
      }

      if (url.pathname === "/slack/interactions") {
        if (request.method !== "POST") {
          return jsonResponse(405, { error: "Method not allowed" });
        }
        return handleSlackInteractions(request, ctx);
      }

      if (url.pathname === "/slack/commands") {
        if (request.method !== "POST") {
          return jsonResponse(405, { error: "Method not allowed" });
        }
        return handleSlackCommands(request);
      }

      return jsonResponse(404, { error: "Not found" });
    } catch (error) {
      logger.error("[WORKER]", error?.message || "Unhandled worker error");
      return jsonResponse(500, { error: "Internal error" });
    }
  },
};
