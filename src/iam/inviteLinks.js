import { logger } from "../utils/logger.js";
import {
  findTrackingRecordForResource,
  isGrantedTrackingStatus,
  upsertAccessTracking,
} from "../notion/accessTracking.js";
import { getAllResources } from "../notion/resources.js";
import { findUserBySlackId } from "../notion/users.js";

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Invite-link providers (Notion / Figma) are not API-verified.
 * - Already Granted in Access Tracking → stay granted (no join button)
 * - Otherwise → awaiting_user_action / Pending so Slack can show the join button
 */
export function provisionInviteLinkResource(resource, trackingRecords = []) {
  if (!resource.provisionEnabled) {
    return {
      resource,
      status: "skipped",
      error: "Provision is disabled for this resource",
      mutated: false,
    };
  }

  const existing = findTrackingRecordForResource(trackingRecords, resource);
  if (existing && isGrantedTrackingStatus(existing.status)) {
    return {
      resource,
      status: "granted",
      error: "",
      mutated: false,
      inviteUrl: resource.inviteUrl || "",
    };
  }

  if (!resource.inviteUrl) {
    logger.warn(
      "[IAM]",
      `${resource.code} has no Invite URL configured`,
    );
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
 * User clicked a Notion/Figma join button: mark Access Tracking as Granted/Synced
 * and return the invite URL so Slack can open/share it.
 */
export async function markInviteLinkJoined({ slackUserId, resourceCode, inviteUrl }) {
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

  const trackingResource = resource
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

  await upsertAccessTracking({
    user,
    policy: null,
    resource: trackingResource,
    status: "granted",
    invitationId: null,
    githubLogin: user.githubUsername || "",
    error: "",
    source: "Provisioned",
    action: "Grant",
    dryRun: false,
  });

  logger.info(
    "[IAM]",
    `Marked ${code} as granted for ${user.email} after join button click`,
  );

  return {
    user,
    resource: trackingResource,
    inviteUrl: trackingResource.inviteUrl || url,
  };
}
