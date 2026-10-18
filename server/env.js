import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Load server/.env when it exists. Import this first in index.js.
// Not done with --env-file-if-exists because Node 22's --watch crashes on it when .env is missing.
const file = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(file)) process.loadEnvFile(file);
