export const SLACK_ACTION_IDS = {
  startOnboarding: "iam_start_onboarding",
  joinInvite: "iam_join_invite",
};

export const SLACK_COMMANDS = {
  iamUpdate: "/iam-update",
};

export const SLACK_BLOCK_IDS = {
  name: "iam_onboarding_name",
  email: "iam_onboarding_email",
  department: "iam_onboarding_department",
  role: "iam_onboarding_role",
};

export const SLACK_ELEMENT_IDS = {
  name: "iam_onboarding_name_input",
  email: "iam_onboarding_email_input",
  department: "iam_onboarding_department_select",
  role: "iam_onboarding_role_select",
};

export const SLACK_VIEW_CALLBACK_ID = "iam_onboarding_submit";
export const SLACK_UPDATE_VIEW_CALLBACK_ID = "iam_update_submit";

export function selectOptions(options = []) {
  return options.map((option) => ({
    text: { type: "plain_text", text: option.label },
    value: option.value,
  }));
}

export function initialSelectOption(options = [], value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const match = options.find((option) => option.value.toLowerCase() === normalized);
  if (!match) {
    return undefined;
  }
  return {
    text: { type: "plain_text", text: match.label },
    value: match.value,
  };
}
