// One-time setup: creates api/.venv and installs api/requirements.txt.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const venv = join(root, "api", ".venv");
const win = process.platform === "win32";
const venvPython = win ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  return r.status === 0;
}

if (!existsSync(venvPython)) {
  const candidates = win ? ["py", "python"] : ["python3", "python"];
  const created = candidates.some((py) => run(py, ["-m", "venv", venv]));
  if (!created) {
    console.error("Could not create a virtualenv. Install Python 3.11+ and try again.");
    process.exit(1);
  }
}

if (!run(venvPython, ["-m", "pip", "install", "-r", join("api", "requirements.txt")])) process.exit(1);
console.log("\nAPI ready. Start everything with `npm run dev`.");
