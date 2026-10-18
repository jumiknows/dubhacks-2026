// Resolve the machine Python. Honors PYTHON, then py / python / python3.
import { spawnSync } from "node:child_process";

const win = process.platform === "win32";

export function pythonCmd() {
  const fromEnv = process.env.PYTHON?.trim();
  const candidates = fromEnv
    ? [fromEnv]
    : win
      ? ["py", "python", "python3"]
      : ["python3", "python"];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ["-c", "import sys; print(sys.executable)"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (probe.status === 0 && probe.stdout.trim()) {
      return { cmd, executable: probe.stdout.trim() };
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
