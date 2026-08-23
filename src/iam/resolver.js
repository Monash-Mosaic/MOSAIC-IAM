import { logger } from "../utils/logger.js";
import { findPoliciesForUser } from "../notion/policies.js";
import { getResourcesByIds } from "../notion/resources.js";

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function dedupePolicies(policies) {
  const grouped = new Map();
  for (const policy of policies) {
    const key = policy.code || policy.pageId;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...policy, resourceIds: [...policy.resourceIds] });
      continue;
    }
    existing.resourceIds = [...new Set([...existing.resourceIds, ...policy.resourceIds])];
  }
  return [...grouped.values()];
}

export function dedupeResources(resources) {
  const grouped = new Map();
  for (const resource of resources) {
    const key = resource.code || `${resource.provider}:${resource.resourceType}:${resource.externalResourceId}`;
    if (!grouped.has(key)) {
      grouped.set(key, resource);
    }
  }
  return [...grouped.values()];
}

export async function resolveDesiredAccess(user) {
  const matches = await findPoliciesForUser(user);
  if (!matches.length) {
    logger.warn(
      "[IAM]",
      `No enabled RBAC policy found for ${user.department} / ${user.role}`,
    );
    return { policies: [], resources: [] };
  }

  const duplicateCodes = new Map();
  for (const policy of matches) {
    duplicateCodes.set(policy.code, (duplicateCodes.get(policy.code) ?? 0) + 1);
  }
  for (const [code, count] of duplicateCodes.entries()) {
    if (count > 1) {
      logger.warn("[IAM]", `Duplicate policy rows found for ${code}; using the first canonical row`);
    }
  }

  const policies = dedupePolicies(matches);
  logger.info("[IAM]", `Policy matched: ${policies.map((policy) => policy.code).join(", ")}`);

  const resourceIds = [...new Set(policies.flatMap((policy) => policy.resourceIds))];
  const resources = dedupeResources(await getResourcesByIds(resourceIds));
  logger.info(
    "[IAM]",
    `Resource resolved: ${resources.map((resource) => resource.code).join(", ") || "(none)"}`,
  );

  return { policies, resources };
}

export function groupResourcesByProvider(resources) {
  const grouped = new Map();
  for (const resource of resources) {
    const key = normalize(resource.provider) || "unknown";
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(resource);
  }
  return grouped;
}
