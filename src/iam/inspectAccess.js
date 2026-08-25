import { logger } from "../utils/logger.js";
import {
  findTrackingRecordForResource,
  getTrackingRecordsForUser,
  isGrantedTrackingStatus,
} from "../notion/accessTracking.js";
import { getAllResources } from "../notion/resources.js";
import { findUserBySlackId } from "../notion/users.js";
import { FIGMA_WORKSPACE_CODE_ALIASES, getFigmaWorkspaceResource } from "../providers/figma.js";
import { getNotionWorkspaceResource } from "../providers/notion.js";
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

function trackingLabel(record, resourcesById) {
  const linked = (record.resourceIds ?? [])
    .map((id) => resourcesById.get(id))
    .find(Boolean);
  if (linked) {
    return resourceLabel(linked);
  }
  return record.resourceCodeHint || record.name || "Unknown resource";
}

/**
 * Resolve IAM user by Slack ID, then inventory Access Tracking via the Users
 * relation and compare against RBAC desired access. Always dry-run for reconcile.
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

  const [trackingRecords, desired, allResources, notionWorkspace, figmaWorkspace] =
    await Promise.all([
      getTrackingRecordsForUser(user),
      resolveDesiredAccess(user),
      getAllResources(),
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

  const resourcesById = new Map(allResources.map((resource) => [resource.pageId, resource]));

  const currentAccess = trackingRecords.map((record) => ({
    trackingId: record.name,
    resourceCodes: record.resourceCodeHint || "",
    resourceLabel: trackingLabel(record, resourcesById),
    resourceIds: record.resourceIds ?? [],
    status: record.status || "(empty)",
    desiredState: record.desiredState || "",
    syncStatus: record.syncStatus || "",
    githubLogin: record.githubLogin || "",
    granted: isGrantedTrackingStatus(record.status),
    error: record.error || "",
  }));

  const desiredAccess = desiredResources.map((resource) => {
    const tracking = findTrackingRecordForResource(trackingRecords, resource);
    return {
      code: resource.code,
      label: resourceLabel(resource),
      provider: resource.provider,
      resourceType: resource.resourceType,
      trackingStatus: tracking?.status || "(missing)",
      trackingDesired: tracking?.desiredState || "",
      trackingSync: tracking?.syncStatus || "",
      githubLogin: tracking?.githubLogin || "",
      granted: Boolean(tracking && isGrantedTrackingStatus(tracking.status)),
      hasTrackingRow: Boolean(tracking),
    };
  });

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
    currentAccess,
    desiredAccess,
    summary: {
      trackingRows: currentAccess.length,
      desiredResources: desiredAccess.length,
      desiredGranted: desiredAccess.filter((item) => item.granted).length,
      desiredMissing: desiredAccess.filter((item) => !item.hasTrackingRow).length,
      desiredNotGranted: desiredAccess.filter((item) => item.hasTrackingRow && !item.granted)
        .length,
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
  lines.push(`GitHub Username (Users table): ${user.githubUsername || "(empty)"}`);
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
    `Current Access Tracking (via Users relation): ${summary.trackingRows} row(s)`,
  );
  if (!report.currentAccess.length) {
    lines.push("  (none linked to this user)");
  } else {
    for (const row of report.currentAccess) {
      const github = row.githubLogin ? ` @${row.githubLogin}` : "";
      lines.push(
        `  • ${row.resourceLabel} — Actual=${row.status} Desired=${row.desiredState || "—"} Sync=${row.syncStatus || "—"}${github}`,
      );
      if (row.error) {
        lines.push(`      error: ${row.error}`);
      }
    }
  }
  lines.push("");

  lines.push(
    `Desired access vs tracking: ${summary.desiredGranted}/${summary.desiredResources} granted, ${summary.desiredMissing} missing rows, ${summary.desiredNotGranted} not granted`,
  );
  for (const item of report.desiredAccess) {
    const mark = item.granted ? "OK" : item.hasTrackingRow ? "NOT GRANTED" : "MISSING";
    const github = item.githubLogin ? ` @${item.githubLogin}` : "";
    lines.push(
      `  [${mark}] ${item.code} — ${item.label} | tracking=${item.trackingStatus}${github}`,
    );
  }

  if (report.reconcileResult) {
    lines.push("");
    lines.push(
      `Dry-run reconcile → IAM Status would be: ${report.reconcileResult.provisioningStatus}`,
    );
    for (const result of report.reconcileResult.results ?? []) {
      const code = result.resource?.code || "?";
      const label = resourceLabel(result.resource);
      const err = result.error ? ` (${result.error})` : "";
      lines.push(`  • ${code} — ${label} → ${result.status}${err}`);
    }
  }

  return lines.join("\n");
}
