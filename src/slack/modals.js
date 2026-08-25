import {
  SLACK_ACTION_IDS,
  SLACK_BLOCK_IDS,
  SLACK_ELEMENT_IDS,
  SLACK_UPDATE_VIEW_CALLBACK_ID,
  SLACK_VIEW_CALLBACK_ID,
  initialSelectOption,
  selectOptions,
} from "./config.js";

function encodeViewMetadata({ slackUserId = "", pageId = "" } = {}) {
  return JSON.stringify({
    slackUserId: slackUserId || "",
    pageId: pageId || "",
  });
}

export function decodeViewMetadata(view) {
  const raw = view?.private_metadata || "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        slackUserId: String(parsed.slackUserId || "").trim(),
        pageId: String(parsed.pageId || "").trim(),
      };
    }
  } catch {
    // Onboarding originally stored the Slack user ID as a bare string.
  }
  return {
    slackUserId: String(raw).trim(),
    pageId: "",
  };
}

function userDetailInputBlocks({ prefill = {}, options = { departments: [], roles: [] } } = {}) {
  const departmentInitial = initialSelectOption(options.departments, prefill.department);
  const roleInitial = initialSelectOption(options.roles, prefill.role);

  return [
    {
      type: "input",
      block_id: SLACK_BLOCK_IDS.name,
      label: { type: "plain_text", text: "Full Name" },
      element: {
        type: "plain_text_input",
        action_id: SLACK_ELEMENT_IDS.name,
        initial_value: prefill.name || undefined,
      },
    },
    {
      type: "input",
      block_id: SLACK_BLOCK_IDS.email,
      label: { type: "plain_text", text: "Email" },
      element: {
        type: "plain_text_input",
        action_id: SLACK_ELEMENT_IDS.email,
        placeholder: { type: "plain_text", text: "you@student.monash.edu" },
        initial_value: prefill.email || undefined,
      },
    },
    {
      type: "input",
      block_id: SLACK_BLOCK_IDS.department,
      label: { type: "plain_text", text: "Department" },
      element: {
        type: "static_select",
        action_id: SLACK_ELEMENT_IDS.department,
        placeholder: { type: "plain_text", text: "Choose your team" },
        options: selectOptions(options.departments),
        ...(departmentInitial ? { initial_option: departmentInitial } : {}),
      },
    },
    {
      type: "input",
      block_id: SLACK_BLOCK_IDS.role,
      label: { type: "plain_text", text: "Role" },
      element: {
        type: "static_select",
        action_id: SLACK_ELEMENT_IDS.role,
        placeholder: { type: "plain_text", text: "Choose your role" },
        options: selectOptions(options.roles),
        ...(roleInitial ? { initial_option: roleInitial } : {}),
      },
    },
  ];
}

export function buildOnboardingModal({ slackUserId, prefill = {}, options = { departments: [], roles: [] } } = {}) {
  return {
    type: "modal",
    callback_id: SLACK_VIEW_CALLBACK_ID,
    private_metadata: encodeViewMetadata({ slackUserId }),
    title: { type: "plain_text", text: "Join MOSAIC" },
    submit: { type: "plain_text", text: "Finish" },
    close: { type: "plain_text", text: "Not now" },
    blocks: userDetailInputBlocks({ prefill, options }),
  };
}

export function buildUpdateModal({
  slackUserId,
  pageId = "",
  found = false,
  prefill = {},
  options = { departments: [], roles: [] },
} = {}) {
  const intro = found
    ? "Confirm these details and change anything that's out of date. Saving will refresh your access if your team or role changed."
    : "We don't have a MOSAIC profile for you yet. Fill this in and we'll save it and set up your access.";

  return {
    type: "modal",
    callback_id: SLACK_UPDATE_VIEW_CALLBACK_ID,
    private_metadata: encodeViewMetadata({ slackUserId, pageId }),
    title: { type: "plain_text", text: "Your details" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: intro },
      },
      ...userDetailInputBlocks({ prefill, options }),
    ],
  };
}

export function parseOnboardingModal(view) {
  const values = view?.state?.values ?? {};
  const name =
    values[SLACK_BLOCK_IDS.name]?.[SLACK_ELEMENT_IDS.name]?.value?.trim() ?? "";
  const email =
    values[SLACK_BLOCK_IDS.email]?.[SLACK_ELEMENT_IDS.email]?.value?.trim() ?? "";
  const department =
    values[SLACK_BLOCK_IDS.department]?.[SLACK_ELEMENT_IDS.department]?.selected_option
      ?.value ?? "";
  const role =
    values[SLACK_BLOCK_IDS.role]?.[SLACK_ELEMENT_IDS.role]?.selected_option?.value ?? "";

  const metadata = decodeViewMetadata(view);
  return {
    name,
    email,
    department,
    role,
    slackUserId: metadata.slackUserId,
    existingPageId: metadata.pageId,
  };
}

export function buildWelcomeBlocks() {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Hey, welcome to *MOSAIC* :wave:\nTell us your name, email, team, and role, and we'll get your access moving.",
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: SLACK_ACTION_IDS.startOnboarding,
          text: { type: "plain_text", text: "Get started" },
          style: "primary",
        },
      ],
    },
  ];
}
