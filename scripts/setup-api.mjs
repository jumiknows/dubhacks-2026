// Install into the same project environment used by development and tests.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pythonCmd, venvPython } from "./python.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(venvPython)) {
  const python = pythonCmd({ system: true });
  if (!python) {
    console.error("Python 3.11+ not found. Install it or set PYTHON to its executable.");
    process.exit(1);
  }
  const created = spawnSync(python.cmd, ["-m", "venv", join(root, "api", ".venv")], { cwd: root, stdio: "inherit" });
  if (created.status !== 0) process.exit(created.status ?? 1);
}
const result = spawnSync(venvPython, ["-m", "pip", "install", "-r", join("api", "requirements.txt")], { cwd: root, stdio: "inherit", env: process.env });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("\nAPI packages installed into api/.venv. Start with `npm run dev`.");
