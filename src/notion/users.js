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
};

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
    lastReconciled: readMappedDate(page, schema, "lastReconciled"),
    error: readMappedText(page, schema, "error"),
    policyIds: readMappedRelations(page, schema, "rbacPolicy"),
  };
}

function isProcessableUser(user) {
  return PROCESSABLE_STATUSES.has(user.status.trim().toLowerCase());
}

export async function getActiveUsers() {
  const env = getEnv();
  const schema = await getDataSourceSchema("users");
  warnIfFieldMissing(schema, "email", true);
  warnIfFieldMissing(schema, "status");
  warnIfFieldMissing(schema, "department");
  warnIfFieldMissing(schema, "role");

  const pages = await queryDataSource(env.NOTION_USERS_DATA_SOURCE_ID);
  const users = pages.map((page) => mapUser(page, schema)).filter((user) => user.email);
  const active = users.filter(isProcessableUser);
  logger.info("[NOTION]", `Loaded ${active.length} processable member(s)`);
  return active;
}

export async function getUserByEmail(email) {
  const users = await getActiveUsers();
  const normalized = email.trim().toLowerCase();
  return users.find((user) => user.email === normalized) ?? null;
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
