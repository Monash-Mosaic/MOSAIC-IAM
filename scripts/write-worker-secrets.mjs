import { writeFileSync } from "node:fs";

const required = [
  "NOTION_TOKEN",
  "NOTION_USERS_DATA_SOURCE_ID",
  "NOTION_POLICIES_DATA_SOURCE_ID",
  "NOTION_RESOURCES_DATA_SOURCE_ID",
  "GH_APP_ID",
  "GH_INSTALLATION_ID",
  "GH_PRIVATE_KEY",
  "GH_ORG",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
];

const optional = [
  "NOTION_WORKSPACE_INVITE_URL",
  "FIGMA_INVITE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "IAM_ENFORCEMENT_MODE",
];

const secrets = { NODE_ENV: "production" };

for (const key of required) {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required GitHub Environment secret/variable: ${key}`);
  }
  secrets[key] = value;
}

for (const key of optional) {
  const value = process.env[key];
  if (value && String(value).trim()) {
    secrets[key] = value;
  }
}

writeFileSync(".worker-secrets.json", JSON.stringify(secrets));
