// Installs api/requirements.txt into the current Python environment (no venv).
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pythonArgs, pythonBin } from "./python.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cmd = pythonBin();
const args = pythonArgs(["-m", "pip", "install", "-r", join("api", "requirements.txt")]);
const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("\nAPI packages installed into this Python. Start with `npm run dev`.");
