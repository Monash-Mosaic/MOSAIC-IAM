import { getRequiredSlackBotToken } from "../config/env.js";
import { logger } from "../utils/logger.js";

const REQUIRED_SCOPES = "users:read, users:read.email";

function isRealActiveSlackUser(member) {
  if (!member || member.deleted) {
    return false;
  }
  if (member.id === "USLACKBOT") {
    return false;
  }
  if (member.is_bot || member.is_app_user) {
    return false;
  }
  return true;
}

function slackUserName(member) {
  return (
    member.profile?.real_name?.trim() ||
    member.real_name?.trim() ||
    member.profile?.display_name?.trim() ||
    member.name?.trim() ||
    ""
  );
}

export async function listActiveSlackUsers() {
  const token = getRequiredSlackBotToken();
  logger.info("[SLACK]", `Listing workspace users (requires ${REQUIRED_SCOPES})`);

  const members = [];
  let cursor = "";
  do {
    const url = new URL("https://slack.com/api/users.list");
    url.searchParams.set("limit", "200");
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(
        `Slack users.list failed: ${payload.error || "unknown"}. Required bot scopes: ${REQUIRED_SCOPES}`,
      );
    }
    members.push(...(payload.members ?? []));
    cursor = payload.response_metadata?.next_cursor ?? "";
  } while (cursor);

  return members.filter(isRealActiveSlackUser).map((member) => ({
    slackUserId: member.id,
    name: slackUserName(member),
    email: String(member.profile?.email ?? "").trim().toLowerCase(),
  }));
}
