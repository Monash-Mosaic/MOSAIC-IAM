import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { queryDataSource } from "./client.js";
import {
  getDataSourceSchema,
  readMappedCheckbox,
  readMappedNumber,
  readMappedText,
  warnIfFieldMissing,
} from "./fields.js";

function parseNumericId(value) {
  if (value == null || value === "") {
    return null;
  }
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function mapResource(page, schema) {
  const enabled = schema.fields.enabled ? readMappedCheckbox(page, schema, "enabled") : true;
  const managedByIam = schema.fields.provisionEnabled
    ? readMappedCheckbox(page, schema, "provisionEnabled")
    : true;
  const provisionEnabled = enabled && managedByIam;

  const externalResourceId =
    readMappedNumber(page, schema, "externalResourceId") ??
    parseNumericId(readMappedText(page, schema, "externalResourceId"));

  const titleName = readMappedText(page, schema, "name");
  const resourceName = readMappedText(page, schema, "externalName");

  return {
    pageId: page.id,
    name: titleName || resourceName,
    code: readMappedText(page, schema, "code").trim() || titleName || resourceName,
    provider: readMappedText(page, schema, "provider"),
    resourceType: readMappedText(page, schema, "resourceType"),
    externalName: resourceName || titleName,
    externalResourceId,
    permission: readMappedText(page, schema, "permission"),
    provisionEnabled,
    revokeEnabled: schema.fields.revokeEnabled
      ? readMappedCheckbox(page, schema, "revokeEnabled")
      : true,
  };
}

let resourceCache;

export async function getAllResources() {
  if (resourceCache) {
    return resourceCache;
  }

  const env = getEnv();
  const schema = await getDataSourceSchema("resources");
  warnIfFieldMissing(schema, "code");
  warnIfFieldMissing(schema, "provider");

  const pages = await queryDataSource(env.NOTION_RESOURCES_DATA_SOURCE_ID);
  resourceCache = pages.map((page) => mapResource(page, schema));
  logger.info("[NOTION]", `Loaded ${resourceCache.length} access resource row(s)`);
  return resourceCache;
}

export async function getResourcesByIds(ids = []) {
  const resources = await getAllResources();
  const idSet = new Set(ids);
  return resources.filter((resource) => idSet.has(resource.pageId));
}
