import { logger } from "../utils/logger.js";
import { upsertIamUser } from "../notion/users.js";
import { reconcileUser } from "./reconciler.js";
import { findOnboardingOption, listOnboardingLabels } from "../config/onboarding.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateOnboardingInput({ name, email, department, role }) {
  const errors = {};
  if (!String(name ?? "").trim()) {
    errors.name = "Full name is required.";
  }
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
    errors.email = "Enter a valid email address.";
  }
  if (!findOnboardingOption("departments", department)) {
    errors.department = `Department must be one of: ${listOnboardingLabels("departments")}.`;
  }
  if (!findOnboardingOption("roles", role)) {
    errors.role = `Role must be one of: ${listOnboardingLabels("roles")}.`;
  }
  return errors;
}

export function normalizeOnboardingInput({ name, email, department, role, slackUserId }) {
  const errors = validateOnboardingInput({ name, email, department, role });
  if (Object.keys(errors).length) {
    const error = new Error(Object.values(errors).join(" "));
    error.validationErrors = errors;
    throw error;
  }

  return {
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    department: findOnboardingOption("departments", department).value,
    role: findOnboardingOption("roles", role).value,
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
  if (reconcileResult.provisioningStatus === "partially provisioned") {
    return "failed";
  }
  return "pending";
}

export function buildOnboardingUserMessage(result) {
  if (result.outcome === "already_complete") {
    return "Your onboarding is already complete and your required access is active.";
  }
  if (result.outcome === "failed" && result.saved) {
    return [
      "Your onboarding was saved, but access provisioning failed.",
      "Please contact an administrator.",
    ].join("\n");
  }
  if (result.outcome === "failed") {
    return "Onboarding could not be saved. Please contact an administrator.";
  }
  return [
    "Onboarding submitted successfully.",
    `Department: ${result.user.department}`,
    `Role: ${result.user.role}`,
    "Your access request is being provisioned.",
    "Check your email for the GitHub organisation invitation.",
  ].join("\n");
}

export async function onboardingService(input, { dryRun = false } = {}) {
  const parsed = normalizeOnboardingInput(input);

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
