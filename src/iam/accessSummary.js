function firstName(user) {
  const name = String(user?.name ?? "").trim();
  return name.split(/\s+/)[0] || "there";
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function providerKey(resource) {
  return normalize(resource?.provider).replace(/\s+/g, "");
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

const INVITE_PROVIDERS = new Set(["notion", "figma"]);

const WORKSPACE_CODES = new Set([
  "nt-workspace",
  "fg-wk",
  "fg-workspace",
]);

function isInviteLinkProvider(resource) {
  return INVITE_PROVIDERS.has(providerKey(resource));
}

function isWorkspaceResource(resource) {
  const code = normalize(resource?.code);
  const type = normalize(resource?.resourceType);
  return WORKSPACE_CODES.has(code) || type === "workspace";
}

function resourceDisplayName(resource) {
  return resource?.externalName || resource?.name || resource?.code || "resource";
}

function inviteButtonLabel(action) {
  const name = action.name || "resource";
  if (action.provider === "figma") {
    return action.isWorkspace ? "Join MOSAIC Figma" : `Join ${name} Figma`;
  }
  if (action.isWorkspace) {
    return "Join MOSAIC Notion Workspace";
  }
  return `Join ${name} Notion Teamspace`;
}

function inviteTextHint(action) {
  const button = inviteButtonLabel(action);
  if (action.provider === "figma") {
    return action.isWorkspace
      ? `• MOSAIC Figma — tap *${button}* below`
      : `• ${action.name} — tap *${button}* below`;
  }
  if (action.isWorkspace) {
    return `• MOSAIC Notion Workspace — tap *${button}* below`;
  }
  return `• ${action.name} Notion Teamspace — tap *${button}* below`;
}

function truncateButtonText(text) {
  const value = String(text ?? "").trim() || "Join";
  return value.length <= 75 ? value : `${value.slice(0, 72)}...`;
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

export function buildAccessSummaryLines(reconcileResult) {
  return (reconcileResult?.results ?? [])
    .filter((result) => !isInviteLinkProvider(result.resource) && result.status !== "skipped")
    .map((result) => `• ${providerLabel(result.resource)} — ${statusLabel(result.status)}`);
}

export function getInviteActions(reconcileResult) {
  return (reconcileResult?.results ?? [])
    .filter((result) => isInviteLinkProvider(result.resource) && result.status !== "skipped")
    .map((result) => {
      const resource = result.resource;
      const provider = providerKey(resource) === "figma" ? "figma" : "notion";
      return {
        code: resource.code,
        name: resourceDisplayName(resource),
        inviteUrl: resource.inviteUrl || result.inviteUrl || "",
        status: result.status,
        isWorkspace: isWorkspaceResource(resource),
        provider,
      };
    });
}

/** @deprecated Prefer getInviteActions */
export function getNotionInviteActions(reconcileResult) {
  return getInviteActions(reconcileResult).filter((action) => action.provider === "notion");
}

function buildInviteSectionLines(provider, actions) {
  const title = provider === "figma" ? "*Figma*" : "*Notion*";
  if (!actions.length) {
    return null;
  }

  const configured = actions.filter((action) => action.inviteUrl);
  const pending = actions.filter((action) => !action.inviteUrl);

  if (!configured.length) {
    return {
      text:
        provider === "figma"
          ? `${title}\nWe'll share your Figma invite shortly.`
          : `${title}\nWe'll share your workspace and teamspace invites shortly.`,
      buttons: [],
    };
  }

  const workspace = configured.find((action) => action.isWorkspace);
  const others = configured.filter((action) => !action.isWorkspace);
  const lines = [title, "A couple of clicks and you're in:"];
  let step = 1;
  if (workspace) {
    lines.push(
      `${step}. ${
        provider === "figma" ? "Join MOSAIC Figma" : "Join the MOSAIC Notion workspace"
      }`,
    );
    step += 1;
  }
  for (const action of others) {
    lines.push(
      `${step}. Join *${action.name}*${provider === "notion" ? " Notion teamspace" : ""}`,
    );
    step += 1;
  }
  if (pending.length) {
    lines.push("We'll share any remaining invites shortly.");
  }

  return {
    text: lines.join("\n"),
    buttons: configured.map((action) => ({
      type: "button",
      text: {
        type: "plain_text",
        text: truncateButtonText(inviteButtonLabel(action)),
      },
      url: action.inviteUrl,
    })),
  };
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

  const inviteActions = getInviteActions(result.reconcileResult);
  const notionActions = inviteActions.filter((action) => action.provider === "notion");
  const figmaActions = inviteActions.filter((action) => action.provider === "figma");

  if (notionActions.length) {
    lines.push("", "*Notion*");
    for (const action of notionActions) {
      lines.push(
        action.inviteUrl
          ? inviteTextHint(action)
          : `• ${action.name} — we'll get this ready for you shortly`,
      );
    }
  }
  if (figmaActions.length) {
    lines.push("", "*Figma*");
    for (const action of figmaActions) {
      lines.push(
        action.inviteUrl
          ? inviteTextHint(action)
          : `• ${action.name} — we'll get this ready for you shortly`,
      );
    }
  }

  lines.push(
    "",
    "That's everything for now. Check your email for GitHub, and use the Notion and Figma buttons if they appear below.",
  );
  return lines.join("\n");
}

export function buildOnboardingResultBlocks(result) {
  const summaryLines = buildAccessSummaryLines(result.reconcileResult);
  const inviteActions = getInviteActions(result.reconcileResult);
  const notionActions = inviteActions.filter((action) => action.provider === "notion");
  const figmaActions = inviteActions.filter((action) => action.provider === "figma");
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

  for (const section of [
    buildInviteSectionLines("notion", notionActions),
    buildInviteSectionLines("figma", figmaActions),
  ]) {
    if (!section) {
      continue;
    }
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: section.text },
    });
    for (const group of chunk(section.buttons, 5)) {
      blocks.push({
        type: "actions",
        elements: group,
      });
    }
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
