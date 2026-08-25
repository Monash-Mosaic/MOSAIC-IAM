import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getNotionClient, queryDataSource } from "./client.js";
import {
  buildPropertyWrite,
  getDataSourceSchema,
  readMappedRelations,
  readMappedText,
  warnIfFieldMissing,
} from "./fields.js";

const ACTUAL_STATE_ALIASES = {
  pending: ["Pending"],
  active: ["Granted", "Active"],
  granted: ["Granted", "Active"],
  failed: ["Unknown", "Pending", "Failed"],
  revoked: ["Revoked"],
  awaiting_user_action: ["Awaiting User Action", "Pending"],
  not_configured: ["Not Configured", "Unknown"],
  needs_configuration: ["Needs Configuration", "Not Configured", "Unknown"],
};

const SYNC_STATUS_ALIASES = {
  pending: ["Pending"],
  active: ["Synced"],
  granted: ["Synced"],
  completed: ["Synced"],
  failed: ["Failed"],
  revoked: ["Synced"],
  awaiting_user_action: ["Pending"],
  not_configured: ["Pending"],
  needs_configuration: ["Pending"],
};

const DESIRED_STATE_ALIASES = {
  granted: ["Granted"],
  revoked: ["Revoked"],
};

const SOURCE_ALIASES = {
  imported: ["Imported"],
  provisioned: ["Provisioned"],
  manual: ["Manual"],
};

const ACTION_ALIASES = {
  grant: ["Grant"],
  "existing access": ["Existing Access", "Grant"],
};

function mapTracking(page, schema) {
  return {
    pageId: page.id,
    name: readMappedText(page, schema, "name"),
    userIds: readMappedRelations(page, schema, "user"),
    email: readMappedText(page, schema, "email").trim().toLowerCase(),
    policyIds: readMappedRelations(page, schema, "policy"),
    resourceIds: readMappedRelations(page, schema, "resource"),
    provider: readMappedText(page, schema, "provider"),
    action: readMappedText(page, schema, "action"),
    source: readMappedText(page, schema, "source"),
    status: readMappedText(page, schema, "status"),
    desiredState: readMappedText(page, schema, "desiredState"),
    syncStatus: readMappedText(page, schema, "syncStatus"),
    invitationId: readMappedText(page, schema, "externalInvitationId") || null,
    githubLogin: readMappedText(page, schema, "githubLogin") || null,
    externalResourceId: readMappedText(page, schema, "externalResourceId") || null,
    error: readMappedText(page, schema, "error"),
    resourceCodeHint: inferResourceCode(readMappedText(page, schema, "name")),
  };
}

function inferResourceCode(name) {
  if (!name) {
    return "";
  }
  const parts = name.split("/").map((part) => part.trim());
  return parts[1] || parts[0] || "";
}

let trackingCache;

export async function getAllTrackingRecords() {
  if (trackingCache) {
    return trackingCache;
  }
  const env = getEnv();
  const schema = await getDataSourceSchema("accessTracking");
  warnIfFieldMissing(schema, "user");
  warnIfFieldMissing(schema, "resource");
  const pages = await queryDataSource(env.NOTION_ACCESS_TRACKING_DATA_SOURCE_ID);
  trackingCache = pages.map((page) => mapTracking(page, schema));
  return trackingCache;
}

export function clearTrackingCache() {
  trackingCache = null;
}

function recordName(record) {
  return String(record?.name ?? "");
}

function recordCodeHint(record) {
  return String(record?.resourceCodeHint ?? "");
}

export async function getTrackingRecordsForUser(userOrEmail) {
  const records = await getAllTrackingRecords();
  if (typeof userOrEmail === "string") {
    const email = userOrEmail.trim().toLowerCase();
    return records.filter(
      (record) => record.email === email || recordName(record).toLowerCase().includes(email),
    );
  }
  const email = userOrEmail.email?.trim().toLowerCase() ?? "";
  return records.filter(
    (record) =>
      record.userIds?.includes(userOrEmail.pageId) ||
      (email && (record.email === email || recordName(record).toLowerCase().includes(email))),
  );
}

export async function findTrackingRecord(user, resourceCode, resourcePageId) {
  const records = await getTrackingRecordsForUser(user);
  const code = String(resourceCode ?? "").trim().toLowerCase();
  return (
    records.find((record) => resourcePageId && record.resourceIds?.includes(resourcePageId)) ??
    records.find((record) => recordCodeHint(record).toLowerCase() === code) ??
    records.find((record) => recordName(record).toLowerCase().includes(code)) ??
    null
  );
}

export async function findTrackingRecordByGithubLogin(githubLogin, resourceCode, resourcePageId) {
  const login = String(githubLogin ?? "").trim().toLowerCase();
  if (!login) {
    return null;
  }
  const records = await getAllTrackingRecords();
  const code = String(resourceCode ?? "").trim().toLowerCase();
  const forLogin = records.filter(
    (record) => String(record.githubLogin ?? "").trim().toLowerCase() === login,
  );
  return (
    forLogin.find((record) => resourcePageId && record.resourceIds?.includes(resourcePageId)) ??
    forLogin.find((record) => recordCodeHint(record).toLowerCase() === code) ??
    forLogin.find((record) => recordName(record).toLowerCase().includes(code)) ??
    null
  );
}

export async function upsertAccessTracking({
  user = null,
  policy,
  resource,
  status,
  invitationId,
  githubLogin,
  error,
  source = "Provisioned",
  action = "Grant",
  dryRun = false,
}) {
  const env = getEnv();
  const schema = await getDataSourceSchema("accessTracking");
  const login = String(githubLogin ?? "").trim();
  const existing = user
    ? await findTrackingRecord(user, resource.code, resource.pageId)
    : await findTrackingRecordByGithubLogin(login, resource.code, resource.pageId);
  const now = new Date().toISOString();
  const identity = user?.email || (login ? `@${login}` : "unknown");
  const title = `${identity} / ${resource.code}`;
  const normalizedStatus = String(status).toLowerCase();

  const properties = {
    ...buildPropertyWrite(schema, "name", title),
    ...buildPropertyWrite(
      schema,
      "user",
      user?.pageId && user.pageId !== "dry-run" ? [user.pageId] : [],
    ),
    ...buildPropertyWrite(schema, "email", user?.email || ""),
    ...buildPropertyWrite(schema, "policy", policy?.pageId ? [policy.pageId] : []),
    ...buildPropertyWrite(schema, "resource", resource.pageId ? [resource.pageId] : []),
    ...buildPropertyWrite(schema, "provider", resource.provider || "GitHub"),
    ...buildPropertyWrite(schema, "action", action, { optionAliases: ACTION_ALIASES }),
    ...buildPropertyWrite(schema, "source", source, { optionAliases: SOURCE_ALIASES }),
    ...buildPropertyWrite(schema, "status", status, { optionAliases: ACTUAL_STATE_ALIASES }),
    ...buildPropertyWrite(schema, "desiredState", "granted", {
      optionAliases: DESIRED_STATE_ALIASES,
    }),
    ...buildPropertyWrite(schema, "syncStatus", status, { optionAliases: SYNC_STATUS_ALIASES }),
    ...buildPropertyWrite(schema, "externalInvitationId", invitationId ? String(invitationId) : ""),
    ...buildPropertyWrite(
      schema,
      "externalResourceId",
      resource.externalResourceId == null ? "" : String(resource.externalResourceId),
    ),
    ...buildPropertyWrite(schema, "githubLogin", login || ""),
    ...buildPropertyWrite(schema, "error", error || ""),
    ...buildPropertyWrite(schema, "lastSync", now),
  };

  if (schema.titleProperty && !schema.fields.name) {
    properties[schema.titleProperty] = {
      title: [{ type: "text", text: { content: title } }],
    };
  }

  if (!existing) {
    Object.assign(properties, buildPropertyWrite(schema, "requestedAt", now));
  }
  if (normalizedStatus === "active") {
    Object.assign(properties, buildPropertyWrite(schema, "grantedAt", now));
  }

  if (dryRun) {
    logger.info(
      "[TRACKING]",
      `DRY RUN would ${existing ? "update" : "create"} ${resource.code} -> ${status}${
        login ? ` (@${login})` : ""
      }`,
    );
    return existing;
  }

  const notion = getNotionClient();
  if (existing) {
    await notion.pages.update({
      page_id: existing.pageId,
      properties,
    });
    logger.info("[TRACKING]", `${resource.code} -> ${status}${login ? ` (@${login})` : ""}`);
    existing.status = status;
    existing.invitationId = invitationId ?? existing.invitationId;
    existing.githubLogin = login || existing.githubLogin;
    existing.error = error || "";
    if (user?.email) {
      existing.email = user.email;
    }
    return existing;
  }

  const created = await notion.pages.create({
    parent: { data_source_id: env.NOTION_ACCESS_TRACKING_DATA_SOURCE_ID },
    properties,
  });
  logger.info("[TRACKING]", `${resource.code} -> ${status}${login ? ` (@${login})` : ""}`);
  const mapped = {
    pageId: created.id,
    name: title,
    email: user?.email || "",
    status,
    invitationId: invitationId ?? null,
    githubLogin: login || null,
    userIds: user?.pageId ? [user.pageId] : [],
    resourceIds: [resource.pageId].filter(Boolean),
    resourceCodeHint: resource.code || "",
    error: error || "",
  };
  (await getAllTrackingRecords()).push(mapped);
  return mapped;
}
