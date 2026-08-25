import { logger } from "../utils/logger.js";
import { getDataSourceSchema } from "./fields.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

const HIDDEN_ROLES = new Set(["founding advisor"]);

let optionsCache = {
  value: null,
  expiresAt: 0,
};

function isHiddenRole(name) {
  return HIDDEN_ROLES.has(String(name ?? "").trim().toLowerCase());
}

function toOptions(names = [], { excludeHiddenRoles = false } = {}) {
  return names
    .map((name) => String(name).trim())
    .filter(Boolean)
    .filter((name) => !excludeHiddenRoles || !isHiddenRole(name))
    .map((name) => ({ value: name, label: name }));
}

export function findSelectOption(options, value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return options.find((option) => option.value.toLowerCase() === normalized) ?? null;
}

export function listSelectLabels(options) {
  return options.map((option) => option.label).join(", ");
}

export async function getUserSelectOptions({ force = false } = {}) {
  if (!force && optionsCache.value && Date.now() < optionsCache.expiresAt) {
    return optionsCache.value;
  }

  const schema = await getDataSourceSchema("users");
  const departments = toOptions(schema.fields.department?.options);
  const roles = toOptions(schema.fields.role?.options, { excludeHiddenRoles: true });
  const value = { departments, roles };
  optionsCache = {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  logger.info(
    "[NOTION]",
    `Loaded IAM user options: departments=${departments.length} roles=${roles.length}`,
  );
  return value;
}

export async function getDepartmentOptions() {
  return (await getUserSelectOptions()).departments;
}

export async function getRoleOptions() {
  return (await getUserSelectOptions()).roles;
}
