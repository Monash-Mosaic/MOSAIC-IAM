import { getEnv } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { queryDataSource } from "./client.js";
import {
  getDataSourceSchema,
  readMappedCheckbox,
  readMappedMultiSelect,
  readMappedRelations,
  readMappedText,
  warnIfFieldMissing,
} from "./fields.js";

function mapPolicy(page, schema) {
  const roles = readMappedMultiSelect(page, schema, "role");
  return {
    pageId: page.id,
    name: readMappedText(page, schema, "name"),
    code: readMappedText(page, schema, "code").trim() || readMappedText(page, schema, "name"),
    department: readMappedText(page, schema, "department"),
    role: roles.join(", "),
    roles,
    resourceIds: readMappedRelations(page, schema, "resources"),
    enabled: schema.fields.enabled ? readMappedCheckbox(page, schema, "enabled") : true,
  };
}

let policyCache;

export async function getAllPolicies() {
  if (policyCache) {
    return policyCache;
  }

  const env = getEnv();
  const schema = await getDataSourceSchema("policies");
  warnIfFieldMissing(schema, "department");
  warnIfFieldMissing(schema, "role");
  warnIfFieldMissing(schema, "code");

  const pages = await queryDataSource(env.NOTION_POLICIES_DATA_SOURCE_ID);
  policyCache = pages.map((page) => mapPolicy(page, schema));
  logger.info("[NOTION]", `Loaded ${policyCache.length} RBAC policy row(s)`);
  return policyCache;
}

export async function findPoliciesForUser(user) {
  const policies = await getAllPolicies();
  const department = user.department.trim().toLowerCase();
  const role = user.role.trim().toLowerCase();

  const matched = policies.filter((policy) => {
    if (!policy.enabled) {
      return false;
    }
    const teamMatches = policy.department.trim().toLowerCase() === department;
    const roleMatches = (policy.roles.length ? policy.roles : [policy.role]).some(
      (policyRole) => policyRole.trim().toLowerCase() === role,
    );
    return teamMatches && roleMatches;
  });

  if (matched.length) {
    return matched;
  }

  if (user.policyIds?.length) {
    const related = policies.filter(
      (policy) => policy.enabled && user.policyIds.includes(policy.pageId),
    );
    if (related.length) {
      logger.warn(
        "[IAM]",
        `No Team/Role policy match for ${user.email}; using ${related.length} related RBAC Policy relation(s)`,
      );
      return related;
    }
  }

  return [];
}
