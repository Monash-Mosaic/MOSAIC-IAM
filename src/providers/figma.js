import { logger } from "../utils/logger.js";
import { getFigmaInviteUrl } from "../config/env.js";
import { getAllResources } from "../notion/resources.js";
import { provisionInviteLinkResource } from "../iam/inviteLinks.js";

export const FIGMA_WORKSPACE_CODE = "FG-WK";
export const FIGMA_WORKSPACE_CODE_ALIASES = ["FG-WK", "FG-WORKSPACE"];

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isFigmaResource(resource) {
  return normalize(resource.provider) === "figma";
}

function isFigmaWorkspaceCode(code) {
  const normalized = normalize(code);
  return FIGMA_WORKSPACE_CODE_ALIASES.some((alias) => normalize(alias) === normalized);
}

function isWorkspaceResource(resource) {
  return (
    isFigmaResource(resource) &&
    (isFigmaWorkspaceCode(resource.code) || normalize(resource.resourceType) === "workspace")
  );
}

export async function getFigmaWorkspaceResource() {
  const resources = await getAllResources();
  const existing =
    resources.find((resource) => isFigmaWorkspaceCode(resource.code)) ??
    resources.find((resource) => isWorkspaceResource(resource));
  const inviteUrl = existing?.inviteUrl || getFigmaInviteUrl();

  if (existing) {
    return {
      ...existing,
      inviteUrl,
      permission: existing.permission || "Edit",
    };
  }

  return {
    pageId: null,
    name: "Figma-Workspace",
    code: FIGMA_WORKSPACE_CODE,
    provider: "Figma",
    resourceType: "Workspace",
    externalName: "MOSAIC",
    externalResourceId: "",
    permission: "Edit",
    provisionEnabled: true,
    revokeEnabled: true,
    inviteUrl,
  };
}

export async function reconcileFigmaAccess(user, resources, { trackingRecords = [], dryRun = false } = {}) {
  const figmaResources = resources.filter(isFigmaResource);
  const results = figmaResources.map((resource) => {
    const result = provisionInviteLinkResource(resource, trackingRecords);
    if (dryRun) {
      logger.info(
        "[FIGMA]",
        `DRY RUN would record ${resource.code} as ${result.status} for ${user.email}`,
      );
    }
    return result;
  });

  return {
    provider: "Figma",
    invitationCreated: false,
    mutated: false,
    results,
  };
}

export const figmaProvider = {
  async reconcile(user, resources, context) {
    return reconcileFigmaAccess(user, resources, context);
  },
  async provision(user, resource, context) {
    return reconcileFigmaAccess(user, [resource], context);
  },
  async verify(user, resource, context) {
    return reconcileFigmaAccess(user, [resource], context);
  },
};
