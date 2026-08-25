function firstName(user) {
  const name = String(user?.name ?? "").trim();
  return name.split(/\s+/)[0] || "there";
}

function providerLabel(resource) {
  const provider = String(resource?.provider ?? "").trim() || "Access";
  const name = resource?.externalName || resource?.name || resource?.code;
  return `${provider} · ${name}`.trim();
}

function statusLabel(status) {
  switch (String(status).toLowerCase()) {
    case "active":
    case "granted":
      return "you're in";
    case "pending":
      return "invite sent — check your email";
    case "awaiting_user_action":
      return "join using the button below";
    case "not_configured":
      return "coming soon";
    case "needs_configuration":
      return "we'll finish this shortly";
    case "failed":
      return "needs a little help from the team";
    default:
      return "in progress";
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
  const isUpdate = result.intent === "update";
  if (result.outcome === "already_complete") {
    return isUpdate
      ? `Thanks ${firstName(result.user)} — your details are saved and your MOSAIC access already matches.`
      : `You're all set, ${firstName(result.user)} — your MOSAIC access is already active. If something looks missing, just ping the team.`;
  }
  if (result.outcome === "failed" && !result.saved) {
    return isUpdate
      ? "Sorry, we couldn't update your details just then. Please try again, or message the MOSAIC team if it keeps happening."
      : "Sorry, we couldn't save your onboarding just then. Please try again, or message the MOSAIC team if it keeps happening.";
  }
  if (result.outcome === "failed" && result.saved) {
    return [
      isUpdate
        ? `Thanks ${firstName(result.user)}, we've updated your details.`
        : `Thanks ${firstName(result.user)}, we've saved your details.`,
      "Some access still needs a hand from the team — they'll follow up if anything is needed from you.",
    ].join("\n");
  }

  const lines = [
    isUpdate
      ? `Thanks ${firstName(result.user)}, your details are up to date.`
      : `Welcome aboard, ${firstName(result.user)}!`,
    `You're listed as *${result.user.department} · ${result.user.role}*. Here's where things stand:`,
    "",
    "*Your access*",
    ...buildAccessSummaryLines(result.reconcileResult),
  ];
  const notionActions = getNotionInviteActions(result.reconcileResult);
  if (notionActions.length) {
    lines.push("", "*Notion*");
    for (const action of notionActions) {
      lines.push(
        action.inviteUrl
          ? action.isWorkspace
            ? "• Workspace — tap *Join MOSAIC workspace* below"
            : `• ${action.name} — tap *Join ${action.name}* below`
          : `• ${action.name} — we'll get this ready for you shortly`,
      );
    }
  }
  lines.push("", "That's everything for now. Check your email for GitHub, and use the Notion buttons if they appear below.");
  return lines.join("\n");
}

export function buildOnboardingResultBlocks(result) {
  const summaryLines = buildAccessSummaryLines(result.reconcileResult);
  const notionActions = getNotionInviteActions(result.reconcileResult);
  const isUpdate = result.intent === "update";
  let greeting;
  if (result.outcome === "already_complete") {
    greeting = isUpdate
      ? `*Thanks ${firstName(result.user)} — you're all set.*\nYour details are saved and your MOSAIC access already matches.`
      : `*You're all set, ${firstName(result.user)}.*\nYour MOSAIC access is already active.`;
  } else if (isUpdate) {
    greeting = `*Thanks ${firstName(result.user)}, your details are up to date.*\nYou're listed as *${result.user.department} · ${result.user.role}*. Here's where things stand:`;
  } else {
    greeting = `*Welcome aboard, ${firstName(result.user)}!*\nYou're joining as *${result.user.department} · ${result.user.role}*. Here's where things stand:`;
  }

  const blocks = [
    {
      type: "section",
      text: { type: "mrkdwn", text: greeting },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Your access*\n${summaryLines.join("\n") || "• You're all caught up here"}`,
      },
    },
  ];

  const configuredInvites = notionActions.filter((action) => action.inviteUrl);
  const pendingInvites = notionActions.filter((action) => !action.inviteUrl);
  if (configuredInvites.length) {
    const workspace = configuredInvites.find((action) => action.isWorkspace);
    const teamspaces = configuredInvites.filter((action) => !action.isWorkspace);
    const notionLines = ["*Notion*", "A couple of clicks and you're in:"];
    if (workspace) {
      notionLines.push("1. Join the MOSAIC workspace");
    }
    teamspaces.forEach((action, index) => {
      notionLines.push(`${workspace ? index + 2 : index + 1}. Join *${action.name}*`);
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
          text: action.isWorkspace ? "Join MOSAIC workspace" : `Join ${action.name}`,
        },
        url: action.inviteUrl,
      })),
    });
  } else if (pendingInvites.length) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Notion*\nWe'll share your workspace and teamspace invites shortly.",
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "GitHub invites go to your email. Message the MOSAIC team if anything looks off.",
      },
    ],
  });
  return blocks;
}
