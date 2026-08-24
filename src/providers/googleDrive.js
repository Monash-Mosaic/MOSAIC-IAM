import { logger } from "../utils/logger.js";
import { isGoogleConfigured } from "../config/env.js";
import {
  createFilePermission,
  findPermissionForEmail,
  mapGoogleDriveRole,
  roleCovers,
} from "../google/drive.js";

function isGoogleDriveResource(resource) {
  const provider = String(resource.provider ?? "").trim().toLowerCase().replace(/\s+/g, "");
  const type = String(resource.resourceType ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return (
    (provider === "googledrive" || provider === "google") &&
    (type === "folder" || type === "shareddrive" || type === "drive")
  );
}

function notConfiguredResult(resource) {
  return {
    resource,
    status: "not_configured",
    error: "",
    mutated: false,
  };
}

export async function verifyGoogleDriveAccess(user, resource) {
  if (!isGoogleConfigured()) {
    return notConfiguredResult(resource);
  }
  const fileId = String(resource.externalResourceId ?? "").trim();
  if (!fileId) {
    return {
      resource,
      status: "needs_configuration",
      error: "Google Drive resource is missing an External Resource ID.",
      mutated: false,
    };
  }
  const desiredRole = mapGoogleDriveRole(resource.permission);
  const existing = await findPermissionForEmail(fileId, user.email);
  if (existing && roleCovers(existing.role, desiredRole)) {
    return { resource, status: "active", error: "", mutated: false };
  }
  return { resource, status: "pending", error: "", mutated: false };
}

export async function provisionGoogleDriveAccess(user, resource, { dryRun = false } = {}) {
  if (!isGoogleConfigured()) {
    logger.info("[GOOGLE]", `GoogleDrive not configured; skipping ${resource.code}`);
    return notConfiguredResult(resource);
  }
  if (!resource.provisionEnabled) {
    return {
      resource,
      status: "skipped",
      error: "Provision is disabled for this resource",
      mutated: false,
    };
  }
  const fileId = String(resource.externalResourceId ?? "").trim();
  if (!fileId) {
    return {
      resource,
      status: "needs_configuration",
      error: "Google Drive resource is missing an External Resource ID.",
      mutated: false,
    };
  }

  const desiredRole = mapGoogleDriveRole(resource.permission);
  const existing = await findPermissionForEmail(fileId, user.email);
  if (existing && roleCovers(existing.role, desiredRole)) {
    return { resource, status: "active", error: "", mutated: false };
  }
  if (dryRun) {
    logger.info("[GOOGLE]", `DRY RUN would grant ${desiredRole} on ${resource.code} to ${user.email}`);
    return { resource, status: "pending", error: "", mutated: true };
  }

  await createFilePermission({ fileId, email: user.email, role: desiredRole });
  return { resource, status: "active", error: "", mutated: true };
}

export async function reconcileGoogleDriveAccess(user, resources, context = {}) {
  const driveResources = resources.filter(isGoogleDriveResource);
  const results = [];
  let mutated = false;

  for (const resource of driveResources) {
    try {
      const result = await provisionGoogleDriveAccess(user, resource, context);
      mutated = mutated || Boolean(result.mutated);
      results.push(result);
    } catch (error) {
      logger.error("[GOOGLE]", `Failed to provision ${resource.code}: ${error.message}`);
      results.push({
        resource,
        status: "failed",
        error: "Google Drive access could not be updated.",
        mutated: false,
      });
    }
  }

  return {
    provider: "GoogleDrive",
    invitationCreated: false,
    mutated,
    results,
  };
}

export const googleDriveProvider = {
  async reconcile(user, resources, context) {
    return reconcileGoogleDriveAccess(user, resources, context);
  },
  async provision(user, resource, context) {
    const result = await provisionGoogleDriveAccess(user, resource, context);
    return {
      provider: "GoogleDrive",
      invitationCreated: false,
      mutated: result.mutated,
      results: [result],
    };
  },
  async verify(user, resource) {
    const result = await verifyGoogleDriveAccess(user, resource);
    return {
      provider: "GoogleDrive",
      invitationCreated: false,
      mutated: false,
      results: [result],
    };
  },
};
