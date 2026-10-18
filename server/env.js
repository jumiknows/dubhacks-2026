import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Existing process settings win, followed by server/.env, then the source web defaults.
// Values stay private. Import this before any module reads configuration.
const inherited = new Set(Object.keys(process.env));
const web = fileURLToPath(new URL("../apps/web/.env.local", import.meta.url));
const file = fileURLToPath(new URL(".env", import.meta.url));
const defaults = {};
if (existsSync(web)) {
  process.loadEnvFile(web);
  for (const key of Object.keys(process.env)) {
    if (!inherited.has(key)) { defaults[key] = process.env[key]; delete process.env[key]; }
  }
}
if (existsSync(file)) process.loadEnvFile(file);
for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
