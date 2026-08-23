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
  const pending = statuses.some((status) => status === "pending");
  const active = statuses.every((status) => status === "active");
  const anyActive = statuses.some((status) => status === "active");

  if (failed && !anyActive && !pending) {
    return "failed";
  }
  if (failed) {
    return "partially provisioned";
  }
  if (active) {
    return "completed";
  }
  if (pending && anyActive) {
    return "partially provisioned";
  }
  if (pending) {
    return "pending";
  }
  return "pending";
}
