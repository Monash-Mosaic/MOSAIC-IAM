import { logger } from "../utils/logger.js";
import { getNotionWorkspaceInviteUrl } from "../config/env.js";
import { getAllResources } from "../notion/resources.js";

export const NOTION_WORKSPACE_CODE = "NT-WORKSPACE";

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isNotionResource(resource) {
  return normalize(resource.provider) === "notion";
}

function isWorkspaceResource(resource) {
  return (
    isNotionResource(resource) &&
    (normalize(resource.code) === normalize(NOTION_WORKSPACE_CODE) ||
      normalize(resource.code) === "nt-wk" ||
      normalize(resource.resourceType) === "workspace")
  );
}

export async function getNotionWorkspaceResource() {
  const resources = await getAllResources();
  const existing =
    resources.find((resource) => normalize(resource.code) === normalize(NOTION_WORKSPACE_CODE)) ??
    resources.find((resource) => normalize(resource.code) === "nt-wk") ??
    resources.find((resource) => isWorkspaceResource(resource));
  const inviteUrl = existing?.inviteUrl || getNotionWorkspaceInviteUrl();

  if (existing) {
    return {
      ...existing,
      inviteUrl,
      permission: existing.permission || "Member",
    };
  }

  return {
    pageId: null,
    name: "Notion Workspace",
    code: NOTION_WORKSPACE_CODE,
    provider: "Notion",
    resourceType: "Workspace",
    externalName: "MOSAIC",
    externalResourceId: "",
    permission: "Member",
    provisionEnabled: true,
    revokeEnabled: true,
    inviteUrl,
  };
}

function provisionInviteResource(resource) {
  if (!resource.provisionEnabled) {
    return {
      resource,
      status: "skipped",
      error: "Provision is disabled for this resource",
      mutated: false,
    };
  }
  // Notion membership is not API-verified. Record desired+actual as Granted.
  return {
    resource,
    status: "granted",
    error: "",
    mutated: false,
    inviteUrl: resource.inviteUrl || "",
  };
}

export async function reconcileNotionAccess(user, resources, { dryRun = false } = {}) {
  const notionResources = resources.filter(isNotionResource);
  const results = notionResources.map((resource) => {
    if (dryRun) {
      logger.info(
        "[NOTION]",
        `DRY RUN would mark ${resource.code} as granted for ${user.email} (invite links are not synced)`,
      );
    }
    return provisionInviteResource(resource);
  });

  return {
    provider: "Notion",
    invitationCreated: false,
    mutated: false,
    results,
  };
}

export const notionProvider = {
  async reconcile(user, resources, context) {
    return reconcileNotionAccess(user, resources, context);
  },
  async provision(user, resource, context) {
    return reconcileNotionAccess(user, [resource], context);
  },
  async verify(_user, resource) {
    return {
      provider: "Notion",
      invitationCreated: false,
      mutated: false,
      results: [provisionInviteResource(resource)],
    };
  },
};
