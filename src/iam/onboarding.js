import { logger } from "../utils/logger.js";
import { upsertIamUser } from "../notion/users.js";
import { findSelectOption, getUserSelectOptions, listSelectLabels } from "../notion/userOptions.js";
import { reconcileUser } from "./reconciler.js";
import { buildOnboardingResultText } from "./accessSummary.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function validateOnboardingInput({ name, email, department, role }) {
  const errors = {};
  if (!String(name ?? "").trim()) {
    errors.name = "Please add your full name.";
  }
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
    errors.email = "Please use a valid email address.";
  }

  const options = await getUserSelectOptions();
  if (!options.departments.length) {
    errors.department = "Teams aren't loading right now. Please try again shortly.";
  } else if (!findSelectOption(options.departments, department)) {
    errors.department = `Please choose a department: ${listSelectLabels(options.departments)}.`;
  }
  if (!options.roles.length) {
    errors.role = "Roles aren't loading right now. Please try again shortly.";
  } else if (!findSelectOption(options.roles, role)) {
    errors.role = `Please choose a role: ${listSelectLabels(options.roles)}.`;
  }
  return errors;
}

export async function normalizeOnboardingInput({ name, email, department, role, slackUserId }) {
  const errors = await validateOnboardingInput({ name, email, department, role });
  if (Object.keys(errors).length) {
    const error = new Error(Object.values(errors).join(" "));
    error.validationErrors = errors;
    throw error;
  }

  const options = await getUserSelectOptions();
  return {
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    department: findSelectOption(options.departments, department).value,
    role: findSelectOption(options.roles, role).value,
    slackUserId: slackUserId ? String(slackUserId).trim() : "",
  };
}

function classifyOutcome(reconcileResult) {
  if (!reconcileResult) {
    return "failed";
  }
  if (reconcileResult.error || reconcileResult.provisioningStatus === "failed") {
    return "failed";
  }
  if (
    reconcileResult.provisioningStatus === "completed" &&
    !reconcileResult.changed &&
    !reconcileResult.invitationCreated
  ) {
    return "already_complete";
  }
  return "pending";
}

export function buildOnboardingUserMessage(result) {
  return buildOnboardingResultText(result);
}

export async function onboardingService(input, { dryRun = false } = {}) {
  let parsed;
  try {
    parsed = await normalizeOnboardingInput(input);
  } catch (error) {
    if (error.validationErrors) {
      throw error;
    }
    logger.error("[ERROR]", `Failed to validate onboarding input: ${error.message}`);
    return {
      outcome: "failed",
      saved: false,
      user: { ...input },
      reconcileResult: null,
      message: "Sorry, we couldn't save your onboarding just then. Please try again, or message the MOSAIC team.",
    };
  }

  let user;
  try {
    user = await upsertIamUser({ ...parsed, dryRun });
  } catch (error) {
    logger.error("[ERROR]", `Failed to upsert IAM user ${parsed.email}: ${error.message}`);
    return {
      outcome: "failed",
      saved: false,
      user: { ...parsed },
      reconcileResult: null,
      message: buildOnboardingUserMessage({ outcome: "failed", saved: false, user: parsed }),
    };
  }

  try {
    const reconcileResult = await reconcileUser(user, { dryRun });
    const outcome = classifyOutcome(reconcileResult);
    const result = {
      outcome,
      saved: true,
      user,
      reconcileResult,
      dryRun,
    };
    result.message = buildOnboardingUserMessage(result);
    return result;
  } catch (error) {
    logger.error("[ERROR]", `Onboarding reconcile failed for ${parsed.email}: ${error.message}`);
    const result = {
      outcome: "failed",
      saved: true,
      user,
      reconcileResult: null,
      dryRun,
    };
    result.message = buildOnboardingUserMessage(result);
    return result;
  }
}
