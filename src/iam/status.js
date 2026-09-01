const SUCCESS_STATUSES = new Set(["active", "granted", "awaiting_user_action"]);
const IN_FLIGHT_STATUSES = new Set(["pending"]);
const SOFT_STATUSES = new Set(["not_configured", "needs_configuration"]);

export function deriveProvisioningStatus(results) {
  if (!results.length) {
    return "failed";
  }

  const statuses = results
    .filter((result) => result.status !== "skipped")
    .map((result) => String(result.status).toLowerCase());

  if (!statuses.length) {
    return "failed";
  }

  const failed = statuses.some((status) => status === "failed");
  const success = statuses.some((status) => SUCCESS_STATUSES.has(status));
  const inFlight = statuses.some((status) => IN_FLIGHT_STATUSES.has(status));
  const soft = statuses.some((status) => SOFT_STATUSES.has(status));
  const allSuccess = statuses.every((status) => SUCCESS_STATUSES.has(status));

  if (failed && !success && !inFlight && !soft) {
    return "failed";
  }
  if (failed || (success && (inFlight || soft)) || (inFlight && soft && success)) {
    return "partially provisioned";
  }
  if (allSuccess) {
    return "completed";
  }
  if (success && (inFlight || soft)) {
    return "partially provisioned";
  }
  return "pending";
}
