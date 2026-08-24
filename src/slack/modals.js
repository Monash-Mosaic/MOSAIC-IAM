import {
  SLACK_ACTION_IDS,
  SLACK_BLOCK_IDS,
  SLACK_ELEMENT_IDS,
  SLACK_VIEW_CALLBACK_ID,
  selectOptions,
} from "./config.js";

export function buildOnboardingModal({ slackUserId, prefill = {}, options = { departments: [], roles: [] } } = {}) {
  return {
    type: "modal",
    callback_id: SLACK_VIEW_CALLBACK_ID,
    private_metadata: slackUserId || "",
    title: { type: "plain_text", text: "Join MOSAIC" },
    submit: { type: "plain_text", text: "Finish" },
    close: { type: "plain_text", text: "Not now" },
    blocks: [
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
          type: "email_text_input",
          action_id: SLACK_ELEMENT_IDS.email,
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
        },
      },
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

  return {
    name,
    email,
    department,
    role,
    slackUserId: view?.private_metadata || "",
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
