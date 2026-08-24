import { logger } from "../utils/logger.js";
import { googleDriveRequest } from "./client.js";

const ROLE_MAP = {
  viewer: "reader",
  reader: "reader",
  commenter: "commenter",
  contributor: "writer",
  writer: "writer",
  "content manager": "fileOrganizer",
  contentmanager: "fileOrganizer",
  fileorganizer: "fileOrganizer",
  manager: "organizer",
  organizer: "organizer",
};

const ROLE_RANK = {
  reader: 1,
  commenter: 2,
  writer: 3,
  fileOrganizer: 4,
  organizer: 5,
};

export function mapGoogleDriveRole(permission) {
  const normalized = String(permission ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  return ROLE_MAP[normalized.replaceAll(" ", "")] || ROLE_MAP[normalized] || "reader";
}

export function roleCovers(existingRole, desiredRole) {
  return (ROLE_RANK[existingRole] ?? 0) >= (ROLE_RANK[desiredRole] ?? 0);
}

export async function listFilePermissions(fileId) {
  const payload = await googleDriveRequest(`/files/${encodeURIComponent(fileId)}/permissions`, {
    query: {
      supportsAllDrives: "true",
      fields: "permissions(id,emailAddress,role,type)",
      pageSize: "100",
    },
  });
  return payload.permissions ?? [];
}

export async function findPermissionForEmail(fileId, email) {
  const permissions = await listFilePermissions(fileId);
  const normalized = email.trim().toLowerCase();
  return (
    permissions.find(
      (permission) =>
        permission.type === "user" && permission.emailAddress?.trim().toLowerCase() === normalized,
    ) ?? null
  );
}

export async function createFilePermission({ fileId, email, role }) {
  logger.info("[GOOGLE]", `Granting ${role} on ${fileId} to ${email}`);
  return googleDriveRequest(`/files/${encodeURIComponent(fileId)}/permissions`, {
    method: "POST",
    query: {
      supportsAllDrives: "true",
      sendNotificationEmail: "true",
      fields: "id,emailAddress,role",
    },
    body: {
      type: "user",
      role,
      emailAddress: email,
    },
  });
}

export async function listSharedDrives() {
  const payload = await googleDriveRequest("/drives", {
    query: {
      pageSize: 100,
      fields: "drives(id,name)",
    },
  });
  return payload.drives ?? [];
}

export async function listAccessibleFolders() {
  const payload = await googleDriveRequest("/files", {
    query: {
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      pageSize: 50,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      fields: "files(id,name,driveId,parents)",
    },
  });
  return payload.files ?? [];
}
