function firstPlainText(richText = []) {
  return richText.map((item) => item.plain_text ?? "").join("").trim();
}

export function getTitle(property) {
  if (!property) {
    return "";
  }
  if (property.type === "title") {
    return firstPlainText(property.title);
  }
  return getRichText(property);
}

export function getRichText(property) {
  if (!property) {
    return "";
  }
  if (property.type === "rich_text") {
    return firstPlainText(property.rich_text);
  }
  if (property.type === "title") {
    return firstPlainText(property.title);
  }
  return "";
}

export function getEmail(property) {
  if (!property) {
    return "";
  }
  if (property.type === "email") {
    return (property.email ?? "").trim();
  }
  return getRichText(property) || getTitle(property);
}

export function getPhoneNumber(property) {
  if (!property) {
    return "";
  }
  if (property.type === "phone_number") {
    return String(property.phone_number ?? "").trim();
  }
  return getRichText(property) || getTitle(property);
}

export function getSelect(property) {
  if (!property) {
    return "";
  }
  if (property.type === "select") {
    return property.select?.name?.trim() ?? "";
  }
  if (property.type === "status") {
    return property.status?.name?.trim() ?? "";
  }
  if (property.type === "multi_select") {
    return (property.multi_select ?? []).map((option) => option.name).filter(Boolean).join(", ");
  }
  return "";
}

export function getMultiSelect(property) {
  if (!property) {
    return [];
  }
  if (property.type === "multi_select") {
    return (property.multi_select ?? []).map((option) => option.name).filter(Boolean);
  }
  if (property.type === "select" && property.select?.name) {
    return [property.select.name];
  }
  if (property.type === "status" && property.status?.name) {
    return [property.status.name];
  }
  return [];
}

export function getStatus(property) {
  return getSelect(property);
}

export function getCheckbox(property) {
  if (!property) {
    return false;
  }
  if (property.type === "checkbox") {
    return Boolean(property.checkbox);
  }
  const select = String(getSelect(property) ?? "").toLowerCase();
  if (["yes", "true", "enabled", "active"].includes(select)) {
    return true;
  }
  const text = String(getRichText(property) || getTitle(property) || "").toLowerCase();
  return ["yes", "true", "enabled"].includes(text);
}

export function getRelationIds(property) {
  if (!property || property.type !== "relation") {
    return [];
  }
  return (property.relation ?? []).map((item) => item.id);
}

export function getNumber(property) {
  if (!property) {
    return null;
  }
  if (property.type === "number") {
    return property.number;
  }
  if (property.type === "unique_id") {
    return property.unique_id?.number ?? null;
  }
  const text = getRichText(property) || getTitle(property) || getSelect(property);
  if (!text) {
    return null;
  }
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function getDate(property) {
  if (!property || property.type !== "date") {
    return null;
  }
  return property.date?.start ?? null;
}

export function getUrl(property) {
  if (!property) {
    return "";
  }
  if (property.type === "url") {
    return property.url ?? "";
  }
  return getRichText(property);
}

export function getPropertyValue(property) {
  if (!property) {
    return "";
  }
  switch (property.type) {
    case "title":
      return getTitle(property);
    case "rich_text":
      return getRichText(property);
    case "email":
      return getEmail(property);
    case "phone_number":
      return getPhoneNumber(property);
    case "select":
    case "status":
      return getSelect(property);
    case "checkbox":
      return getCheckbox(property);
    case "number":
      return getNumber(property);
    case "date":
      return getDate(property);
    case "url":
      return getUrl(property);
    case "relation":
      return getRelationIds(property);
    default:
      return getRichText(property) || getTitle(property) || getSelect(property);
  }
}

export function notionText(value) {
  return {
    rich_text: [{ type: "text", text: { content: value == null ? "" : String(value).slice(0, 2000) } }],
  };
}

export function notionTitle(value) {
  return {
    title: [{ type: "text", text: { content: value == null ? "" : String(value).slice(0, 2000) } }],
  };
}

export function notionSelect(name) {
  if (!name) {
    return { select: null };
  }
  return { select: { name } };
}

export function notionStatus(name) {
  if (!name) {
    return { status: null };
  }
  return { status: { name } };
}

export function notionDate(isoDate) {
  if (!isoDate) {
    return { date: null };
  }
  return { date: { start: isoDate } };
}

export function notionRelation(ids = []) {
  return {
    relation: ids.filter(Boolean).map((id) => ({ id })),
  };
}

export function notionEmail(value) {
  return { email: value || null };
}

export function notionPhoneNumber(value) {
  const phone = String(value ?? "").trim();
  return { phone_number: phone || null };
}

export function notionNumber(value) {
  if (value === null || value === undefined || value === "") {
    return { number: null };
  }
  const numeric = Number(value);
  return { number: Number.isNaN(numeric) ? null : numeric };
}

export function notionUrl(value) {
  return { url: value || null };
}

export function notionCheckbox(value) {
  return { checkbox: Boolean(value) };
}

export function pickClosestOption(desired, options = [], aliases = {}) {
  if (!desired) {
    return null;
  }
  if (!options.length) {
    return desired;
  }
  const normalizedDesired = String(desired).trim().toLowerCase();
  const exact = options.find((option) => String(option ?? "").toLowerCase() === normalizedDesired);
  if (exact) {
    return exact;
  }
  const aliasTargets = aliases[normalizedDesired] ?? [];
  for (const alias of aliasTargets) {
    const match = options.find((option) => String(option ?? "").toLowerCase() === alias.toLowerCase());
    if (match) {
      return match;
    }
  }
  const includes = options.find(
    (option) => {
      const normalizedOption = String(option ?? "").toLowerCase();
      return (
        normalizedOption.includes(normalizedDesired) ||
        normalizedDesired.includes(normalizedOption)
      );
    },
  );
  return includes ?? null;
}
