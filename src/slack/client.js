import { App } from "@slack/bolt";
import { getSlackEnv } from "../config/env.js";

export function createSlackApp() {
  const slack = getSlackEnv();
  return new App({
    token: slack.SLACK_BOT_TOKEN,
    signingSecret: slack.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: slack.SLACK_APP_TOKEN,
  });
}
