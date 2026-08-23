import { githubProvider } from "./github.js";

const registry = new Map([
  ["github", githubProvider],
  ["gh", githubProvider],
]);

export function getProvider(providerName) {
  return registry.get(String(providerName ?? "").trim().toLowerCase()) ?? null;
}

export function registerProvider(name, provider) {
  registry.set(String(name).trim().toLowerCase(), provider);
}
