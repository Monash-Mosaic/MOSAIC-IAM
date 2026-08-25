import { getEnforcementMode } from "../config/env.js";
import { logger } from "../utils/logger.js";
import {
  getTrackingRecordsForUser,
  upsertAccessTracking,
} from "../notion/accessTracking.js";
import { updateUserProvisioningStatus } from "../notion/users.js";
import { getProvider } from "../providers/index.js";
import { FIGMA_WORKSPACE_CODE_ALIASES, getFigmaWorkspaceResource } from "../providers/figma.js";
import { getNotionWorkspaceResource } from "../providers/notion.js";
import { groupResourcesByProvider, resolveDesiredAccess } from "./resolver.js";
import { deriveProvisioningStatus } from "./status.js";

function withDefaultResource(resources, extra) {
  const codes = new Set(
    [extra.code, ...(extra.codeAliases ?? [])].map((code) => String(code ?? "").trim().toUpperCase()).filter(Boolean),
  );
  if (resources.some((resource) => codes.has(resource.code.trim().toUpperCase()))) {
    return resources;
  }
  return [...resources, extra];
}

function findPolicyForResource(policies, resource) {
  return (
    policies.find((policy) => policy.resourceIds.includes(resource.pageId)) ??
    policies[0] ??
    null
  );
}

export async function reconcileUser(user, { dryRun = false } = {}) {
  logger.info("[IAM]", `Reconciling ${user.email}`);
  const enforcementMode = getEnforcementMode();
  if (enforcementMode === "observe") {
    logger.info("[IAM]", "Enforcement mode=observe: destructive revocation is disabled");
  } else if (enforcementMode === "unset") {
    logger.info(
      "[IAM]",
      "IAM_ENFORCEMENT_MODE unset: preserving current grant behaviour (GitHub revoke remains unimplemented)",
    );
  }

  const { policies, resources: resolvedResources } = await resolveDesiredAccess(user);
  const [notionWorkspace, figmaWorkspace] = await Promise.all([
    getNotionWorkspaceResource(),
    getFigmaWorkspaceResource(),
  ]);
  const resources = withDefaultResource(
    withDefaultResource(resolvedResources, notionWorkspace),
    {
      ...figmaWorkspace,
      codeAliases: FIGMA_WORKSPACE_CODE_ALIASES,
    },
  );
  const trackingRecords = await getTrackingRecordsForUser(user);
  const now = new Date().toISOString();
  logger.info(
    "[IAM]",
    `Access Tracking via Users relation: ${trackingRecords.length} row(s) for Slack ${user.slackUserId || "(none)"} / ${user.email}`,
  );

  if (!policies.length) {
    const status = "failed";
    await updateUserProvisioningStatus(user, {
      provisioningStatus: status,
      lastReconciled: now,
      error: `No enabled RBAC policy found for ${user.department} / ${user.role}`,
      dryRun,
    });
    return {
      user,
      changed: true,
      provisioningStatus: status,
      invitationCreated: false,
      results: [],
      error: `No enabled RBAC policy found for ${user.department} / ${user.role}`,
    };
  }

  const grouped = groupResourcesByProvider(resources);
  const allResults = [];
  let invitationCreated = false;
  let mutated = false;
  let githubLogin = trackingRecords.find((record) => record.githubLogin)?.githubLogin ?? null;

  for (const [providerName, providerResources] of grouped.entries()) {
    const provider = getProvider(providerName);
    if (!provider) {
      logger.warn("[IAM]", `No provider adapter registered for ${providerName}`);
      for (const resource of providerResources) {
        allResults.push({
          resource,
          status: "failed",
          error: `No provider adapter registered for ${providerName}`,
          mutated: false,
        });
      }
      continue;
    }

    let outcome;
    try {
      outcome = await provider.reconcile(user, providerResources, {
        trackingRecords,
        dryRun,
      });
    } catch (error) {
      logger.error("[IAM]", `Provider ${providerName} failed for ${user.email}: ${error.message}`);
      outcome = {
        invitationCreated: false,
        mutated: false,
        results: providerResources.map((resource) => ({
          resource,
          status: "failed",
          error: "Access could not be updated.",
          mutated: false,
        })),
      };
    }
    invitationCreated = invitationCreated || Boolean(outcome.invitationCreated);
    mutated = mutated || Boolean(outcome.mutated);
    githubLogin = outcome.githubLogin || githubLogin;
    allResults.push(...outcome.results);
  }

  for (const result of allResults) {
    const resource = result.resource;
    if (!resource) {
      continue;
    }
    await upsertAccessTracking({
      user,
      policy: findPolicyForResource(policies, resource),
      resource,
      status: result.status === "skipped" ? "failed" : result.status,
      invitationId: result.invitationId ?? null,
      githubLogin: result.githubLogin || githubLogin,
      error: result.error || "",
      source: "Provisioned",
      action: "Grant",
      dryRun,
    });
    mutated = mutated || Boolean(result.mutated);
  }

  const provisioningStatus = deriveProvisioningStatus(allResults);
  await updateUserProvisioningStatus(user, {
    provisioningStatus,
    lastReconciled: now,
    error: provisioningStatus === "failed" || provisioningStatus === "partially provisioned"
      ? allResults.find((result) => result.error)?.error || ""
      : "",
    dryRun,
  });

  const changed = mutated || invitationCreated;
  if (!changed && provisioningStatus === "completed") {
    logger.info("[IAM]", `${user.name || user.email} already matches desired state. No changes required.`);
  }

  return {
    user,
    changed,
    provisioningStatus,
    invitationCreated,
    results: allResults,
  };
}
