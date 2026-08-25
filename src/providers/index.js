import { figmaProvider } from "./figma.js";
import { githubProvider } from "./github.js";
import { googleDriveProvider } from "./googleDrive.js";
import { notionProvider } from "./notion.js";
import { slackProvider } from "./slack.js";

const registry = new Map([
  ["github", githubProvider],
  ["gh", githubProvider],
  ["googledrive", googleDriveProvider],
  ["google", googleDriveProvider],
  ["gd", googleDriveProvider],
  ["notion", notionProvider],
  ["nt", notionProvider],
  ["figma", figmaProvider],
  ["fg", figmaProvider],
  ["slack", slackProvider],
]);

export function getProvider(providerName) {
  return registry.get(String(providerName ?? "").trim().toLowerCase().replace(/\s+/g, "")) ?? null;
}

export function registerProvider(name, provider) {
  registry.set(String(name).trim().toLowerCase().replace(/\s+/g, ""), provider);
}
