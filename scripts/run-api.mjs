// Starts the Conjure API from the repo root using the project Python environment.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pythonArgs, pythonBin } from "./python.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cmd = pythonBin();
const production = process.argv.includes("--production") || process.argv.includes("--prod");
const args = pythonArgs(["-m", "uvicorn", "api.main:app", "--host", process.env.API_HOST || "127.0.0.1", "--port", process.env.API_PORT || "8000",
  ...(production ? [] : ["--reload", "--reload-dir", "api"])]);
const child = spawn(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
