import { logger } from "../utils/logger.js";
import { getOptionalSlackBotToken } from "../config/env.js";

function isSlackChannelResource(resource) {
  const provider = String(resource.provider ?? "").trim().toLowerCase();
  const type = String(resource.resourceType ?? "").trim().toLowerCase();
  return provider === "slack" && (type === "channel" || type === "channels");
}

async function slackApi(method, body) {
  const token = getOptionalSlackBotToken();
  if (!token) {
    return { ok: false, error: "not_configured" };
  }
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return response.json();
}

function alreadyInChannel(payload) {
  if (payload.error === "already_in_channel") {
    return true;
  }
  return (payload.errors ?? []).some((item) => item.error === "already_in_channel");
}

export async function provisionSlackChannelAccess(user, resource, { dryRun = false } = {}) {
  if (!getOptionalSlackBotToken()) {
    return {
      resource,
      status: "not_configured",
      error: "",
      mutated: false,
    };
  }
  if (!resource.provisionEnabled) {
    return {
      resource,
      status: "skipped",
      error: "Provision is disabled for this resource",
      mutated: false,
    };
  }
  const channelId = String(resource.externalResourceId ?? "").trim();
  if (!channelId) {
    return {
      resource,
      status: "needs_configuration",
      error: "Slack channel resource is missing an External Resource ID.",
      mutated: false,
    };
  }
  if (!user.slackUserId) {
    return {
      resource,
      status: "failed",
      error: "Slack User ID is missing on the IAM user.",
      mutated: false,
    };
  }
  if (dryRun) {
    logger.info("[SLACK]", `DRY RUN would invite ${user.slackUserId} to ${resource.code}`);
    return { resource, status: "pending", error: "", mutated: true };
  }

  const payload = await slackApi("conversations.invite", {
    channel: channelId,
    users: user.slackUserId,
  });
  if (payload.ok || alreadyInChannel(payload)) {
    return { resource, status: "active", error: "", mutated: Boolean(payload.ok) };
  }
  logger.error("[SLACK]", `Channel invite failed for ${resource.code}: ${payload.error || "unknown"}`);
  return {
    resource,
    status: "failed",
    error: "Slack channel access could not be updated.",
    mutated: false,
  };
}

export async function reconcileSlackAccess(user, resources, context = {}) {
  const channelResources = resources.filter(isSlackChannelResource);
  const results = [];
  let mutated = false;
  for (const resource of channelResources) {
    const result = await provisionSlackChannelAccess(user, resource, context);
    mutated = mutated || Boolean(result.mutated);
    results.push(result);
  }
  return {
    provider: "Slack",
    invitationCreated: false,
    mutated,
    results,
  };
}

export const slackProvider = {
  async reconcile(user, resources, context) {
    return reconcileSlackAccess(user, resources, context);
  },
  async provision(user, resource, context) {
    const result = await provisionSlackChannelAccess(user, resource, context);
    return {
      provider: "Slack",
      invitationCreated: false,
      mutated: result.mutated,
      results: [result],
    };
  },
  async verify(user, resource, context) {
    const result = await provisionSlackChannelAccess(user, resource, { ...context, dryRun: true });
    return {
      provider: "Slack",
      invitationCreated: false,
      mutated: false,
      results: [{ ...result, mutated: false }],
    };
  },
};
