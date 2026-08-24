import { createSlackApp } from "./client.js";
import { registerEvents } from "./events.js";
import { registerActions } from "./actions.js";

export function registerSlackHandlers(app) {
  registerEvents(app);
  registerActions(app);
}

export { createSlackApp };
