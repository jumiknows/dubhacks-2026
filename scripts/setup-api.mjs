// One-time setup: creates api/.venv and installs api/requirements.txt into it.
// Set PYTHON to install into a specific interpreter instead (no venv).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pythonArgs, pythonBin, root, venvPython } from "./python.mjs";

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, stdio: "inherit", env: process.env }).status === 0;
}

let target = venvPython;
if (process.env.PYTHON?.trim()) {
  target = pythonBin();
} else if (!existsSync(venvPython)) {
  const base = pythonBin({ preferVenv: false });
  if (!run(base, pythonArgs(["-m", "venv", join("api", ".venv")], { preferVenv: false }))) {
    console.error("Could not create api/.venv. Install Python 3.11+ and try again.");
    process.exit(1);
  }
}

const args = target === "py" ? ["-3", "-m", "pip", "install", "-r", join("api", "requirements.txt")]
  : ["-m", "pip", "install", "-r", join("api", "requirements.txt")];
if (!run(target, args)) process.exit(1);
console.log("\nAPI ready. Start everything with `npm run dev`.");
