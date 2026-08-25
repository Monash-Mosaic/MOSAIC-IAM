import { logger } from "../utils/logger.js";
import { getFigmaInviteUrl } from "../config/env.js";
import { getAllResources } from "../notion/resources.js";

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

function provisionInviteResource(resource) {
  if (!resource.provisionEnabled) {
    return {
      resource,
      status: "skipped",
      error: "Provision is disabled for this resource",
      mutated: false,
    };
  }
  if (!resource.inviteUrl) {
    logger.warn("[FIGMA]", `${resource.code} has no Invite URL configured`);
    return {
      resource,
      status: "needs_configuration",
      error: "Invite URL is not configured for this Figma resource.",
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

export async function reconcileFigmaAccess(user, resources, { dryRun = false } = {}) {
  const figmaResources = resources.filter(isFigmaResource);
  const results = figmaResources.map((resource) => {
    if (dryRun) {
      logger.info("[FIGMA]", `DRY RUN would issue invite action for ${resource.code} to ${user.email}`);
    }
    return provisionInviteResource(resource);
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
  async verify(_user, resource) {
    return {
      provider: "Figma",
      invitationCreated: false,
      mutated: false,
      results: [provisionInviteResource(resource)],
    };
  },
};
