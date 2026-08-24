import { pickClosestOption } from "../notion/helpers.js";
import { logger } from "../utils/logger.js";

export function reportMappedOption(schema, fieldKey, desired, aliases = {}) {
  const field = schema.fields[fieldKey];
  if (!field) {
    logger.warn("[BOOTSTRAP]", `Notion field "${fieldKey}" is not configured; write skipped`);
    return;
  }
  const picked = pickClosestOption(desired, field.options, aliases);
  if (!picked) {
    logger.warn(
      "[BOOTSTRAP]",
      `No Notion option on "${field.name}" matches "${desired}". Add the option or accept the closest later.`,
    );
    return;
  }
  if (String(picked).trim().toLowerCase() !== String(desired).trim().toLowerCase()) {
    logger.warn(
      "[BOOTSTRAP]",
      `Mapped ${field.name} "${desired}" -> "${picked}" (closest configured Notion option)`,
    );
  }
}
