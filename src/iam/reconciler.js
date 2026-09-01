import { getEnforcementMode } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { updateUserGithubUsername, updateUserProvisioningStatus } from "../notion/users.js";
import { getProvider } from "../providers/index.js";
import { FIGMA_WORKSPACE_CODE_ALIASES, getFigmaWorkspaceResource } from "../providers/figma.js";
import { getNotionWorkspaceResource } from "../providers/notion.js";
import { groupResourcesByProvider, resolveDesiredAccess } from "./resolver.js";
import { deriveProvisioningStatus } from "./status.js";

function withDefaultResource(resources, extra) {
  const codes = new Set(
    [extra.code, ...(extra.codeAliases ?? [])]
      .map((code) => String(code ?? "").trim().toUpperCase())
      .filter(Boolean),
  );
  if (resources.some((resource) => codes.has(resource.code.trim().toUpperCase()))) {
    return resources;
  }
  return [...resources, extra];
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

  if (!policies.length) {
    const status = "failed";
    const now = new Date().toISOString();
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
  let githubLogin = user.githubUsername || null;
  let githubUsernameUpdated = false;
  const now = new Date().toISOString();

  async function persistGithubLogin(login) {
    const normalized = String(login ?? "").trim();
    if (!normalized) {
      return;
    }
    githubLogin = normalized;
    if (githubUsernameUpdated || user.githubUsername === normalized) {
      githubUsernameUpdated = true;
      return;
    }
    const updated = await updateUserGithubUsername(user, normalized, { dryRun });
    user.githubUsername = updated.githubUsername;
    githubUsernameUpdated = true;
  }

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
      outcome = await provider.reconcile(user, providerResources, { dryRun, policies });
    } catch (error) {
      const detail = error?.message || "Access could not be updated.";
      logger.error("[IAM]", `Provider ${providerName} failed for ${user.email}: ${detail}`);
      outcome = {
        invitationCreated: false,
        mutated: false,
        results: providerResources.map((resource) => ({
          resource,
          status: "failed",
          error: detail,
          mutated: false,
        })),
      };
    }
    invitationCreated = invitationCreated || Boolean(outcome.invitationCreated);
    mutated = mutated || Boolean(outcome.mutated);
    if (outcome.githubLogin) {
      await persistGithubLogin(outcome.githubLogin);
    }
    allResults.push(...outcome.results);
  }

  for (const result of allResults) {
    if (result.githubLogin) {
      await persistGithubLogin(result.githubLogin);
    }
    mutated = mutated || Boolean(result.mutated);
  }

  const provisioningStatus = deriveProvisioningStatus(allResults);
  await updateUserProvisioningStatus(user, {
    provisioningStatus,
    lastReconciled: now,
    error:
      provisioningStatus === "failed" || provisioningStatus === "partially provisioned"
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
    githubLogin,
  };
}
