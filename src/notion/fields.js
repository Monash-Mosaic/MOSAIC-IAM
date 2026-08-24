import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { getNotionClient } from "./client.js";
import {
  getCheckbox,
  getDate,
  getEmail,
  getMultiSelect,
  getNumber,
  getPropertyValue,
  getRelationIds,
  getRichText,
  getSelect,
  getTitle,
  getUrl,
  notionCheckbox,
  notionDate,
  notionEmail,
  notionNumber,
  notionRelation,
  notionSelect,
  notionStatus,
  notionText,
  notionTitle,
  notionUrl,
  pickClosestOption,
} from "./helpers.js";

export const NOTION_FIELDS = {
  users: {
    name: ["Name"],
    email: ["Email"],
    department: ["Team", "Department"],
    role: ["Role"],
    status: ["Status"],
    provisioningStatus: ["IAM Status", "Provisioning Status", "ProvisioningStatus"],
    slackUserId: ["Slack ID", "Slack User ID", "Slack User Id"],
    lastReconciled: ["Last IAM Sync", "Last Reconciled", "Last Reconciled At"],
    error: ["IAM Error", "Error"],
    preferredName: ["Preferred Name"],
    rbacPolicy: ["RBAC Policy", "IAM - RBAC Policies"],
  },
  policies: {
    name: ["Policy Name", "Name"],
    code: ["Policy ID", "Policy Code", "Code"],
    department: ["Team", "Department"],
    role: ["Role"],
    resources: ["Access Resources", "Resources", "Resource"],
    enabled: ["Enabled", "Active"],
  },
  resources: {
    name: ["Name", "Resource Name"],
    code: ["Resource ID", "Resource Code", "Code"],
    provider: ["Service", "Provider"],
    resourceType: ["Resource Type", "Type"],
    externalName: ["Resource Name", "External Name", "Team Name"],
    externalResourceId: ["External Resource ID", "External Resource Id", "Team ID", "GitHub Team ID", "Slack Channel ID", "Drive ID"],
    permission: ["Access Level", "Permission"],
    provisionEnabled: ["Managed By IAM", "Provision Enabled", "Provision"],
    revokeEnabled: ["Revoke Enabled", "Revoke"],
    enabled: ["Enabled", "Active"],
    inviteUrl: ["Invite URL", "Invite Url", "Invitation URL", "Invite Link"],
  },
  accessTracking: {
    name: ["Tracking ID", "Name"],
    user: ["Users", "User"],
    email: ["Email"],
    policy: ["Policy", "RBAC Policy"],
    resource: ["Resource", "Access Resource"],
    provider: ["Provider"],
    action: ["Action"],
    status: ["Actual State", "Status"],
    desiredState: ["Desired State"],
    syncStatus: ["Sync Status"],
    externalInvitationId: ["External User ID", "External Invitation ID", "Invitation ID"],
    externalResourceId: ["External Resource ID", "External Resource Id"],
    githubLogin: ["External Username", "GitHub Username", "GitHub Login"],
    requestedAt: ["Requested At"],
    grantedAt: ["Granted At"],
    lastSync: ["Last Sync"],
    revokedAt: ["Revoked At"],
    error: ["Error", "Error Message", "Notes"],
  },
};

const schemaCache = new Map();

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findPropertyName(properties, aliases) {
  const names = Object.keys(properties);
  for (const alias of aliases) {
    const exact = names.find((name) => name === alias);
    if (exact) {
      return exact;
    }
  }
  for (const alias of aliases) {
    const normalizedAlias = normalizeName(alias);
    const match = names.find((name) => normalizeName(name) === normalizedAlias);
    if (match) {
      return match;
    }
  }
  return null;
}

function getPropertyOptions(property) {
  if (property.type === "select") {
    return (property.select?.options ?? []).map((option) => option.name);
  }
  if (property.type === "status") {
    return (property.status?.options ?? []).map((option) => option.name);
  }
  if (property.type === "multi_select") {
    return (property.multi_select?.options ?? []).map((option) => option.name);
  }
  return [];
}

export async function getDataSourceSchema(kind) {
  if (schemaCache.has(kind)) {
    return schemaCache.get(kind);
  }

  const env = getEnv();
  const dataSourceIds = {
    users: env.NOTION_USERS_DATA_SOURCE_ID,
    policies: env.NOTION_POLICIES_DATA_SOURCE_ID,
    resources: env.NOTION_RESOURCES_DATA_SOURCE_ID,
    accessTracking: env.NOTION_ACCESS_TRACKING_DATA_SOURCE_ID,
  };
  const dataSourceId = dataSourceIds[kind];
  const notion = getNotionClient();
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = dataSource.properties ?? {};
  const titleProperty =
    Object.entries(properties).find(([, property]) => property.type === "title")?.[0] ?? null;

  const fields = {};
  for (const [key, aliases] of Object.entries(NOTION_FIELDS[kind])) {
    const names = titleProperty && key === "name" ? [titleProperty, ...aliases] : aliases;
    const actualName = findPropertyName(properties, names);
    fields[key] = actualName
      ? {
          name: actualName,
          type: properties[actualName].type,
          options: getPropertyOptions(properties[actualName]),
        }
      : null;
  }

  const schema = {
    dataSourceId,
    title: dataSource.title?.map((part) => part.plain_text).join("") ?? kind,
    titleProperty,
    properties,
    fields,
  };
  schemaCache.set(kind, schema);
  return schema;
}

export function getMappedProperty(page, schema, fieldKey) {
  const field = schema.fields[fieldKey];
  if (!field) {
    return null;
  }
  return page.properties?.[field.name] ?? null;
}

export function readMappedValue(page, schema, fieldKey) {
  return getPropertyValue(getMappedProperty(page, schema, fieldKey));
}

export function readMappedText(page, schema, fieldKey) {
  const property = getMappedProperty(page, schema, fieldKey);
  if (!property) {
    return "";
  }
  if (property.type === "title") {
    return getTitle(property);
  }
  if (property.type === "email") {
    return getEmail(property);
  }
  if (property.type === "select" || property.type === "status") {
    return getSelect(property);
  }
  if (property.type === "number") {
    const value = getNumber(property);
    return value == null ? "" : String(value);
  }
  if (property.type === "url") {
    return getUrl(property);
  }
  return getRichText(property) || getTitle(property) || getSelect(property) || getUrl(property);
}

export function readMappedNumber(page, schema, fieldKey) {
  return getNumber(getMappedProperty(page, schema, fieldKey));
}

export function readMappedCheckbox(page, schema, fieldKey) {
  return getCheckbox(getMappedProperty(page, schema, fieldKey));
}

export function readMappedRelations(page, schema, fieldKey) {
  return getRelationIds(getMappedProperty(page, schema, fieldKey));
}

export function readMappedMultiSelect(page, schema, fieldKey) {
  return getMultiSelect(getMappedProperty(page, schema, fieldKey));
}

export function readMappedDate(page, schema, fieldKey) {
  return getDate(getMappedProperty(page, schema, fieldKey));
}

export function buildPropertyWrite(schema, fieldKey, value, { optionAliases = {} } = {}) {
  const field = schema.fields[fieldKey];
  if (!field || value === undefined) {
    return {};
  }

  switch (field.type) {
    case "title":
      return { [field.name]: notionTitle(value) };
    case "rich_text":
      return { [field.name]: notionText(value) };
    case "email":
      return { [field.name]: notionEmail(value) };
    case "select": {
      const option = pickClosestOption(value, field.options, optionAliases);
      return option ? { [field.name]: notionSelect(option) } : {};
    }
    case "status": {
      const option = pickClosestOption(value, field.options, optionAliases);
      return option ? { [field.name]: notionStatus(option) } : {};
    }
    case "number":
      return { [field.name]: notionNumber(value) };
    case "date":
      return { [field.name]: notionDate(value) };
    case "relation":
      return { [field.name]: notionRelation(Array.isArray(value) ? value : [value]) };
    case "checkbox":
      return { [field.name]: notionCheckbox(value) };
    case "url":
      return { [field.name]: notionUrl(value) };
    default:
      logger.warn("[NOTION]", `Unsupported write for ${field.name} (${field.type})`);
      return {};
  }
}

export function warnIfFieldMissing(schema, fieldKey, required = false) {
  if (schema.fields[fieldKey]) {
    return;
  }
  const message = `Notion ${schema.title} is missing expected field aliases for "${fieldKey}"`;
  if (required) {
    throw new Error(message);
  }
  logger.warn("[NOTION]", message);
}
