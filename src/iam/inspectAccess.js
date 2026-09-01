import { logger } from "../utils/logger.js";
import { findUserBySlackId } from "../notion/users.js";
import { evaluateGitHubTeamAccess } from "../providers/github.js";
import { FIGMA_WORKSPACE_CODE_ALIASES, getFigmaWorkspaceResource } from "../providers/figma.js";
import { getNotionWorkspaceResource } from "../providers/notion.js";
import { resolveTeam } from "../github/teams.js";
import { reconcileUser } from "./reconciler.js";
import { resolveDesiredAccess } from "./resolver.js";

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

function resourceLabel(resource) {
  const provider = String(resource?.provider ?? "").trim() || "Access";
  const name = resource?.externalName || resource?.name || resource?.code || "";
  return `${provider} · ${name}`.trim();
}

function providerKey(resource) {
  return String(resource?.provider ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function isGitHubTeam(resource) {
  return (
    providerKey(resource) === "github" &&
    String(resource?.resourceType ?? "").trim().toLowerCase() === "team"
  );
}

function isInviteProvider(resource) {
  const provider = providerKey(resource);
  return provider === "notion" || provider === "figma";
}

async function liveStatusForResource(user, resource) {
  if (isInviteProvider(resource)) {
    return {
      status: resource.inviteUrl ? "join_link" : "needs_configuration",
      message: resource.inviteUrl
        ? "join with the link if you haven't already"
        : "invite URL is not configured",
      githubLogin: "",
    };
  }

  if (!isGitHubTeam(resource)) {
    return {
      status: "desired",
      message: "checked during provision",
      githubLogin: "",
    };
  }

  const team = await resolveTeam({
    externalResourceId: resource.externalResourceId,
    externalName: resource.externalName,
    code: resource.code,
  });
  if (!team) {
    return {
      status: "failed",
      message: "GitHub team could not be resolved",
      githubLogin: "",
    };
  }

  const access = await evaluateGitHubTeamAccess({
    user,
    team,
    knownLogin: user.githubUsername || null,
  });
  return {
    status: access.status === "missing" ? "not_in_team" : access.status,
    message: access.message || (access.status === "missing" ? "not a member" : access.status),
    githubLogin: access.githubLogin || "",
  };
}

/**
 * Resolve IAM user by Slack ID, then compare RBAC desired access against live
 * provider state (GitHub team invitations/membership, Notion/Figma invite links).
 * Always dry-run for reconcile.
 */
export async function inspectAccessBySlackId(slackUserId, { reconcile = false } = {}) {
  const slackId = String(slackUserId ?? "").trim();
  if (!slackId) {
    throw new Error("Slack user ID is required");
  }

  const user = await findUserBySlackId(slackId);
  if (!user) {
    throw new Error(`No IAM user found with Slack ID ${slackId}`);
  }

  logger.info("[INSPECT]", `Resolved Slack ID ${slackId} → ${user.name} <${user.email}>`);

  const [desired, notionWorkspace, figmaWorkspace] = await Promise.all([
    resolveDesiredAccess(user),
    getNotionWorkspaceResource(),
    getFigmaWorkspaceResource(),
  ]);

  const desiredResources = withDefaultResource(
    withDefaultResource(desired.resources, notionWorkspace),
    {
      ...figmaWorkspace,
      codeAliases: FIGMA_WORKSPACE_CODE_ALIASES,
    },
  );

  const desiredAccess = [];
  for (const resource of desiredResources) {
    const live = await liveStatusForResource(user, resource);
    desiredAccess.push({
      code: resource.code,
      label: resourceLabel(resource),
      provider: resource.provider,
      resourceType: resource.resourceType,
      status: live.status,
      message: live.message,
      githubLogin: live.githubLogin,
      inviteUrl: resource.inviteUrl || "",
    });
  }

  let reconcileResult = null;
  if (reconcile) {
    logger.info("[INSPECT]", "Running reconcile dry-run (no writes)...");
    reconcileResult = await reconcileUser(user, { dryRun: true });
  }

  return {
    slackUserId: slackId,
    user: {
      pageId: user.pageId,
      name: user.name,
      email: user.email,
      department: user.department,
      role: user.role,
      status: user.status,
      provisioningStatus: user.provisioningStatus,
      slackUserId: user.slackUserId,
      githubUsername: user.githubUsername || "",
    },
    policies: desired.policies.map((policy) => ({
      code: policy.code,
      name: policy.name,
    })),
    desiredAccess,
    summary: {
      desiredResources: desiredAccess.length,
      githubAlreadyInTeam: desiredAccess.filter((item) => item.status === "active").length,
      githubInvitationSent: desiredAccess.filter((item) => item.status === "pending").length,
      githubMissing: desiredAccess.filter((item) => item.status === "not_in_team").length,
    },
    reconcileResult,
  };
}

export function formatInspectAccessReport(report) {
  const lines = [];
  const { user, summary } = report;

  lines.push("=== IAM access inspect (read-only) ===");
  lines.push(`Slack ID: ${report.slackUserId}`);
  lines.push(`User: ${user.name} <${user.email}>`);
  lines.push(`Team / Role: ${user.department} · ${user.role}`);
  lines.push(`User Status: ${user.status || "(empty)"}`);
  lines.push(`IAM Status: ${user.provisioningStatus || "(empty)"}`);
  lines.push(`Github Username (Members): ${user.githubUsername || "(empty)"}`);
  lines.push(`Notion Users page: ${user.pageId}`);
  lines.push("");

  lines.push("Policies matched:");
  if (!report.policies.length) {
    lines.push("  (none)");
  } else {
    for (const policy of report.policies) {
      lines.push(`  • ${policy.code} — ${policy.name}`);
    }
  }
  lines.push("");

  lines.push(
    `Desired access (live): ${summary.desiredResources} resource(s) — GitHub in team=${summary.githubAlreadyInTeam} invitation sent=${summary.githubInvitationSent} not in team=${summary.githubMissing}`,
  );
  for (const item of report.desiredAccess) {
    const github = item.githubLogin ? ` @${item.githubLogin}` : "";
    lines.push(`  [${item.status}] ${item.code} — ${item.label} | ${item.message}${github}`);
  }

  if (report.reconcileResult) {
    lines.push("");
    lines.push(
      `Dry-run reconcile → IAM Status would be: ${report.reconcileResult.provisioningStatus}`,
    );
    for (const result of report.reconcileResult.results ?? []) {
      const code = result.resource?.code || "?";
      const label = resourceLabel(result.resource);
      const message = result.message ? ` — ${result.message}` : "";
      const err = result.error ? ` (${result.error})` : "";
      lines.push(`  • ${code} — ${label} → ${result.status}${message}${err}`);
    }
  }

  return lines.join("\n");
}
