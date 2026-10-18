// Resolve the API's Python. Honors PYTHON, then the project's api/.venv
// (created by `npm run api:setup`), then py / python / python3 on PATH.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const win = process.platform === "win32";
export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const venvPython = join(root, "api", ".venv", win ? "Scripts/python.exe" : "bin/python");

export function pythonCmd({ preferVenv = true } = {}) {
  const fromEnv = process.env.PYTHON?.trim();
  if (fromEnv) return probe(fromEnv);
  if (preferVenv && existsSync(venvPython)) return { cmd: venvPython, executable: venvPython };
  for (const cmd of win ? ["py", "python", "python3"] : ["python3", "python"]) {
    const found = probe(cmd);
    if (found) return found;
  }
  return null;
}

function probe(cmd) {
  const result = spawnSync(cmd, ["-c", "import sys; print(sys.executable)"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 && result.stdout.trim() ? { cmd, executable: result.stdout.trim() } : null;
}

function required(options) {
  const found = pythonCmd(options);
  if (!found) {
    console.error("Python not found. Install Python 3.11+ and run `npm run api:setup`, or set PYTHON to the interpreter.");
    process.exit(1);
  }
  return found;
}

export function pythonArgs(args, options) {
  return required(options).cmd === "py" ? ["-3", ...args] : args;
}

export function pythonBin(options) {
  return required(options).cmd;
}
