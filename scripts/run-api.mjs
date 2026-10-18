// Starts the Conjure API (FastAPI) from the repo root using the api/.venv Python.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const python =
  process.platform === "win32"
    ? join(root, "api", ".venv", "Scripts", "python.exe")
    : join(root, "api", ".venv", "bin", "python");

if (!existsSync(python)) {
  console.error("API virtualenv not found. Run `npm run api:setup` first.");
  process.exit(1);
}

const args = ["-m", "uvicorn", "api.main:app", "--reload", "--reload-dir", "api", "--port", "8000"];
const child = spawn(python, args, { cwd: root, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
