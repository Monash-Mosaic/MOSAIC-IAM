import { logger } from "../utils/logger.js";
import { getAllResources } from "../notion/resources.js";
import { findUserBySlackId } from "../notion/users.js";

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Invite-link providers (Notion / Figma) are not API-verified.
 * Always surface the join button when an Invite URL exists. The user joins
 * with the link if they haven't already, otherwise they can ignore it.
 */
export function provisionInviteLinkResource(resource) {
  if (!resource.provisionEnabled) {
    return {
      resource,
      status: "skipped",
      error: "Provision is disabled for this resource",
      mutated: false,
    };
  }

  if (!resource.inviteUrl) {
    logger.warn("[IAM]", `${resource.code} has no Invite URL configured`);
    return {
      resource,
      status: "needs_configuration",
      error: "Invite URL is not configured for this resource.",
      mutated: false,
    };
  }

  return {
    resource,
    status: "awaiting_user_action",
    error: "",
    mutated: false,
    inviteUrl: resource.inviteUrl,
  };
}

export function encodeInviteActionValue({ code, inviteUrl, provider }) {
  return JSON.stringify({
    c: String(code ?? "").trim(),
    u: String(inviteUrl ?? "").trim(),
    p: String(provider ?? "").trim().toLowerCase(),
  });
}

export function decodeInviteActionValue(raw) {
  try {
    const parsed = JSON.parse(String(raw ?? ""));
    const code = String(parsed?.c ?? "").trim();
    const inviteUrl = String(parsed?.u ?? "").trim();
    const provider = String(parsed?.p ?? "").trim().toLowerCase();
    if (!code || !inviteUrl) {
      return null;
    }
    return { code, inviteUrl, provider };
  } catch {
    return null;
  }
}

/**
 * User clicked a Notion/Figma join button: return the invite URL so Slack can
 * open/share it. Membership is not tracked — join if you haven't, else ignore.
 */
export async function resolveInviteLink({ slackUserId, resourceCode, inviteUrl }) {
  const slackId = String(slackUserId ?? "").trim();
  const code = String(resourceCode ?? "").trim();
  const url = String(inviteUrl ?? "").trim();
  if (!slackId || !code || !url) {
    throw new Error("Slack user, resource code, and invite URL are required");
  }

  const user = await findUserBySlackId(slackId);
  if (!user) {
    throw new Error(`No IAM user found for Slack ID ${slackId}`);
  }

  const resources = await getAllResources();
  const resource =
    resources.find((item) => normalize(item.code) === normalize(code)) ?? null;

  const inviteResource = resource
    ? { ...resource, inviteUrl: resource.inviteUrl || url }
    : {
        pageId: null,
        name: code,
        code,
        provider: "Invite",
        resourceType: "Invite",
        externalName: code,
        externalResourceId: "",
        permission: "",
        provisionEnabled: true,
        revokeEnabled: true,
        inviteUrl: url,
      };

  logger.info("[IAM]", `Sharing ${code} invite link with ${user.email}`);

  return {
    user,
    resource: inviteResource,
    inviteUrl: inviteResource.inviteUrl || url,
  };
}
