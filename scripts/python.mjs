// Use the project environment for setup, development, and tests alike.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const win = process.platform === "win32";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const venvPython = join(root, "api", ".venv", win ? "Scripts/python.exe" : "bin/python");

export function pythonCmd({ system = false } = {}) {
  const fromEnv = process.env.PYTHON?.trim();
  const candidates = fromEnv
    ? [fromEnv]
    : !system && existsSync(venvPython)
      ? [venvPython]
    : win
      ? ["py", "python", "python3"]
      : ["python3.13", "python3.12", "python3.11", "python3", "python"];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ["-c", "import sys; sys.exit(1) if sys.version_info < (3, 11) else print(sys.executable)"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (probe.status === 0 && probe.stdout.trim()) {
      return { cmd: probe.stdout.trim(), executable: probe.stdout.trim() };
    }
  }
  return null;
}

export function pythonArgs(args) {
  const found = pythonCmd();
  if (!found) {
    console.error("Python not found on PATH. Install Python 3.11+ or set PYTHON to the interpreter.");
    process.exit(1);
  }
  return found.cmd === "py" ? ["-3", ...args] : args;
}

export function pythonBin() {
  const found = pythonCmd();
  if (!found) {
    console.error("Python not found on PATH. Install Python 3.11+ or set PYTHON to the interpreter.");
    process.exit(1);
  }
  return found.cmd;
}
