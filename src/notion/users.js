import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getNotionClient, queryDataSource } from "./client.js";
import {
  buildPropertyWrite,
  getDataSourceSchema,
  readMappedDate,
  readMappedRelations,
  readMappedText,
  warnIfFieldMissing,
} from "./fields.js";

const PROCESSABLE_STATUSES = new Set(["active", "provisioning"]);

const IAM_STATUS_ALIASES = {
  pending: ["Pending"],
  failed: ["Failed"],
  completed: ["Synced", "Complete"],
  "partially provisioned": ["Partial"],
  syncing: ["Syncing"],
  imported: ["Imported", "Needs Classification", "Pending"],
  "needs classification": ["Needs Classification", "Imported", "Pending"],
};

const INACTIVE_USER_STATUSES = new Set([
  "inactive",
  "offboarded",
  "revoked",
  "disabled",
  "departed",
  "alumni",
  "deleted",
  "left",
]);

function mapUser(page, schema) {
  return {
    pageId: page.id,
    name: readMappedText(page, schema, "name"),
    email: readMappedText(page, schema, "email").trim().toLowerCase(),
    department: readMappedText(page, schema, "department"),
    role: readMappedText(page, schema, "role"),
    status: readMappedText(page, schema, "status"),
    provisioningStatus: readMappedText(page, schema, "provisioningStatus"),
    slackUserId: readMappedText(page, schema, "slackUserId"),
    githubUsername: readMappedText(page, schema, "githubUsername"),
    lastReconciled: readMappedDate(page, schema, "lastReconciled"),
    error: readMappedText(page, schema, "error"),
    policyIds: readMappedRelations(page, schema, "rbacPolicy"),
  };
}

function isProcessableUser(user) {
  return PROCESSABLE_STATUSES.has(user.status.trim().toLowerCase());
}

const USER_STATUS_ALIASES = {
  active: ["Active"],
};

export async function getAllUsers() {
  const env = getEnv();
  const schema = await getDataSourceSchema("users");
  warnIfFieldMissing(schema, "email", true);
  warnIfFieldMissing(schema, "status");
  warnIfFieldMissing(schema, "department");
  warnIfFieldMissing(schema, "role");

  const pages = await queryDataSource(env.NOTION_USERS_DATA_SOURCE_ID);
  return pages.map((page) => mapUser(page, schema)).filter((user) => user.email);
}

export async function getActiveUsers() {
  const users = await getAllUsers();
  const active = users.filter(isProcessableUser);
  logger.info("[NOTION]", `Loaded ${active.length} processable member(s)`);
  return active;
}

export async function findUserByEmail(email) {
  const users = await getAllUsers();
  const normalized = email.trim().toLowerCase();
  return users.find((user) => user.email === normalized) ?? null;
}

export async function getUserByEmail(email) {
  const users = await getActiveUsers();
  const normalized = email.trim().toLowerCase();
  return users.find((user) => user.email === normalized) ?? null;
}

export async function upsertIamUser({
  name,
  email,
  department,
  role,
  slackUserId = "",
  dryRun = false,
}) {
  const env = getEnv();
  const schema = await getDataSourceSchema("users");
  warnIfFieldMissing(schema, "email", true);

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  const properties = {
    ...buildPropertyWrite(schema, "name", name),
    ...buildPropertyWrite(schema, "email", normalizedEmail),
    ...buildPropertyWrite(schema, "department", department),
    ...buildPropertyWrite(schema, "role", role),
    ...buildPropertyWrite(schema, "status", "Active", { optionAliases: USER_STATUS_ALIASES }),
    ...buildPropertyWrite(schema, "provisioningStatus", "Pending", {
      optionAliases: IAM_STATUS_ALIASES,
    }),
    ...buildPropertyWrite(schema, "slackUserId", slackUserId || ""),
  };

  if (schema.titleProperty && !schema.fields.name) {
    Object.assign(properties, {
      [schema.titleProperty]: { title: [{ type: "text", text: { content: name } }] },
    });
  }

  const mapped = {
    pageId: existing?.pageId ?? null,
    name,
    email: normalizedEmail,
    department,
    role,
    status: "Active",
    provisioningStatus: "Pending",
    slackUserId: slackUserId || existing?.slackUserId || "",
    githubUsername: existing?.githubUsername || "",
    lastReconciled: existing?.lastReconciled ?? null,
    error: "",
    policyIds: existing?.policyIds ?? [],
  };

  if (dryRun) {
    logger.info(
      "[NOTION]",
      `DRY RUN would ${existing ? "update" : "create"} IAM user ${normalizedEmail}`,
    );
    return {
      ...mapped,
      pageId: existing?.pageId ?? "dry-run",
      created: !existing,
    };
  }

  const notion = getNotionClient();
  if (existing) {
    await notion.pages.update({
      page_id: existing.pageId,
      properties,
    });
    logger.info("[NOTION]", `Updated IAM user ${normalizedEmail}`);
    return { ...mapped, pageId: existing.pageId, created: false };
  }

  const created = await notion.pages.create({
    parent: { data_source_id: env.NOTION_USERS_DATA_SOURCE_ID },
    properties,
  });
  logger.info("[NOTION]", `Created IAM user ${normalizedEmail}`);
  return { ...mapped, pageId: created.id, created: true };
}

function isClearlyInactive(status) {
  return INACTIVE_USER_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export async function upsertImportedIamUser({
  name,
  email,
  slackUserId = "",
  githubUsername = "",
  dryRun = false,
}) {
  const env = getEnv();
  const schema = await getDataSourceSchema("users");
  warnIfFieldMissing(schema, "email", true);

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  const properties = {
    ...buildPropertyWrite(schema, "email", normalizedEmail),
  };

  if (!existing) {
    Object.assign(
      properties,
      buildPropertyWrite(schema, "name", name),
      buildPropertyWrite(schema, "slackUserId", slackUserId || ""),
      buildPropertyWrite(schema, "githubUsername", githubUsername || ""),
      buildPropertyWrite(schema, "status", "Active", { optionAliases: USER_STATUS_ALIASES }),
      buildPropertyWrite(schema, "provisioningStatus", "Imported", {
        optionAliases: IAM_STATUS_ALIASES,
      }),
    );
    if (schema.titleProperty && !schema.fields.name) {
      Object.assign(properties, {
        [schema.titleProperty]: { title: [{ type: "text", text: { content: name } }] },
      });
    }
  } else {
    if (!existing.name && name) {
      Object.assign(properties, buildPropertyWrite(schema, "name", name));
    }
    if (!existing.slackUserId && slackUserId) {
      Object.assign(properties, buildPropertyWrite(schema, "slackUserId", slackUserId));
    }
    if (!existing.githubUsername && githubUsername) {
      Object.assign(properties, buildPropertyWrite(schema, "githubUsername", githubUsername));
    }
    if (!existing.status || isClearlyInactive(existing.status)) {
      Object.assign(
        properties,
        buildPropertyWrite(schema, "status", "Active", { optionAliases: USER_STATUS_ALIASES }),
      );
    }
  }

  const mapped = {
    pageId: existing?.pageId ?? null,
    name: existing?.name || name,
    email: normalizedEmail,
    department: existing?.department || "",
    role: existing?.role || "",
    status:
      !existing || !existing.status || isClearlyInactive(existing.status)
        ? "Active"
        : existing.status,
    provisioningStatus: existing?.provisioningStatus || "Imported",
    slackUserId: existing?.slackUserId || slackUserId || "",
    githubUsername: existing?.githubUsername || githubUsername || "",
    lastReconciled: existing?.lastReconciled ?? null,
    error: existing?.error || "",
    policyIds: existing?.policyIds ?? [],
  };

  if (dryRun) {
    logger.info(
      "[NOTION]",
      `DRY RUN would ${existing ? "update" : "create"} imported IAM user ${normalizedEmail}`,
    );
    return {
      ...mapped,
      pageId: existing?.pageId ?? "dry-run",
      created: !existing,
      updated: Boolean(existing),
    };
  }

  const notion = getNotionClient();
  if (existing) {
    await notion.pages.update({
      page_id: existing.pageId,
      properties,
    });
    logger.info("[NOTION]", `Enriched imported IAM user ${normalizedEmail}`);
    return { ...mapped, pageId: existing.pageId, created: false, updated: true };
  }

  const created = await notion.pages.create({
    parent: { data_source_id: env.NOTION_USERS_DATA_SOURCE_ID },
    properties,
  });
  logger.info("[NOTION]", `Created imported IAM user ${normalizedEmail}`);
  return { ...mapped, pageId: created.id, created: true, updated: false };
}

export async function updateUserProvisioningStatus(
  user,
  { provisioningStatus, lastReconciled, error, dryRun = false },
) {
  const schema = await getDataSourceSchema("users");
  const properties = {
    ...buildPropertyWrite(schema, "provisioningStatus", provisioningStatus, {
      optionAliases: IAM_STATUS_ALIASES,
    }),
    ...buildPropertyWrite(schema, "lastReconciled", lastReconciled),
    ...buildPropertyWrite(schema, "error", error ?? ""),
  };

  if (!Object.keys(properties).length) {
    logger.warn("[NOTION]", `No writable IAM status fields found for ${user.email}`);
    return;
  }

  if (dryRun) {
    logger.info(
      "[NOTION]",
      `DRY RUN would update ${user.email} IAM Status to ${provisioningStatus}`,
    );
    return;
  }

  const notion = getNotionClient();
  await notion.pages.update({
    page_id: user.pageId,
    properties,
  });
}
