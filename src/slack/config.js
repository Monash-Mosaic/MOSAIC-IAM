import { ONBOARDING_OPTIONS } from "../config/onboarding.js";

export { ONBOARDING_OPTIONS, findOnboardingOption, listOnboardingLabels } from "../config/onboarding.js";

export const SLACK_ACTION_IDS = {
  startOnboarding: "iam_start_onboarding",
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

export function selectOptions(kind) {
  return (ONBOARDING_OPTIONS[kind] ?? []).map((option) => ({
    text: { type: "plain_text", text: option.label },
    value: option.value,
  }));
}
