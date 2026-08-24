function providerLabel(resource) {
  const provider = String(resource.provider ?? "").trim() || "Access";
  const name = resource.externalName || resource.name || resource.code;
  return `${provider} ${name}`.trim();
}

function statusLabel(status) {
  switch (String(status).toLowerCase()) {
    case "active":
    case "granted":
      return "Added";
    case "pending":
      return "Invitation sent";
    case "awaiting_user_action":
      return "Awaiting your action";
    case "not_configured":
      return "Not configured yet";
    case "needs_configuration":
      return "Needs configuration";
    case "failed":
      return "Could not be provisioned";
    default:
      return "Pending";
  }
}

function isNotionResult(result) {
  return String(result.resource?.provider ?? "").trim().toLowerCase() === "notion";
}

export function buildAccessSummaryLines(reconcileResult) {
  return (reconcileResult?.results ?? [])
    .filter((result) => !isNotionResult(result) && result.status !== "skipped")
    .map((result) => `• ${providerLabel(result.resource)} — ${statusLabel(result.status)}`);
}

export function getNotionInviteActions(reconcileResult) {
  return (reconcileResult?.results ?? [])
    .filter((result) => isNotionResult(result) && result.status !== "skipped")
    .map((result) => {
      const resource = result.resource;
      const isWorkspace =
        String(resource.code ?? "").toUpperCase() === "NT-WORKSPACE" ||
        String(resource.resourceType ?? "").toLowerCase() === "workspace";
      return {
        code: resource.code,
        name: resource.externalName || resource.name || resource.code,
        inviteUrl: resource.inviteUrl || result.inviteUrl || "",
        status: result.status,
        isWorkspace,
      };
    });
}

export function buildOnboardingResultText(result) {
  if (result.outcome === "already_complete") {
    return "Your onboarding is already complete and your required access is active.";
  }
  if (result.outcome === "failed" && !result.saved) {
    return "Onboarding could not be saved. Please contact an administrator.";
  }
  if (result.outcome === "failed" && result.saved) {
    return [
      "Your onboarding was saved, but some access could not be provisioned.",
      "Please contact an administrator if this continues.",
    ].join("\n");
  }

  const lines = [
    "Onboarding submitted successfully.",
    `Department: ${result.user.department}`,
    `Role: ${result.user.role}`,
    "",
    "Access setup",
    ...buildAccessSummaryLines(result.reconcileResult),
  ];
  const notionActions = getNotionInviteActions(result.reconcileResult);
  if (notionActions.length) {
    lines.push("Notion:");
    for (const action of notionActions) {
      lines.push(
        action.inviteUrl
          ? action.isWorkspace
            ? `Join Notion Workspace: ${action.inviteUrl}`
            : `Join ${action.name} teamspace: ${action.inviteUrl}`
          : `${action.name} — Needs configuration`,
      );
    }
  }
  return lines.join("\n");
}

export function buildOnboardingResultBlocks(result) {
  const summaryLines = buildAccessSummaryLines(result.reconcileResult);
  const notionActions = getNotionInviteActions(result.reconcileResult);
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Access setup*\n${summaryLines.join("\n") || "No access resources were resolved."}`,
      },
    },
  ];

  const configuredInvites = notionActions.filter((action) => action.inviteUrl);
  if (!configuredInvites.length) {
    return blocks;
  }

  const workspace = configuredInvites.find((action) => action.isWorkspace);
  const teamspaces = configuredInvites.filter((action) => !action.isWorkspace);
  const notionLines = ["*Notion setup*"];
  if (workspace) {
    notionLines.push("1. Join the MOSAIC workspace");
  }
  teamspaces.forEach((action, index) => {
    notionLines.push(`${workspace ? index + 2 : index + 1}. Join your ${action.name} teamspace`);
  });
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: notionLines.join("\n") },
  });
  blocks.push({
    type: "actions",
    elements: configuredInvites.map((action) => ({
      type: "button",
      text: {
        type: "plain_text",
        text: action.isWorkspace ? "Join Notion Workspace" : `Join ${action.name} Teamspace`,
      },
      url: action.inviteUrl,
    })),
  });
  return blocks;
}
