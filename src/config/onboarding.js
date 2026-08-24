export const ONBOARDING_OPTIONS = {
  departments: [{ value: "Engineering", label: "Engineering" }],
  roles: [{ value: "Developer", label: "Developer" }],
};

export function findOnboardingOption(kind, value) {
  const options = ONBOARDING_OPTIONS[kind] ?? [];
  const normalized = String(value ?? "").trim().toLowerCase();
  return options.find((option) => option.value.toLowerCase() === normalized) ?? null;
}

export function listOnboardingLabels(kind) {
  return (ONBOARDING_OPTIONS[kind] ?? []).map((option) => option.label).join(", ");
}
