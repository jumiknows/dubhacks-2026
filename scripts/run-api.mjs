// Starts the Python API from the repo root (api/.venv when present, see python.mjs).
// `--prod` turns off auto-reload for `npm start`.
import { spawn } from "node:child_process";
import { pythonArgs, pythonBin, root } from "./python.mjs";

const prod = process.argv.includes("--prod");
const cmd = pythonBin();
const args = pythonArgs([
  "-m", "uvicorn", "api.main:app", "--port", process.env.API_PORT || "8000",
  ...(prod ? [] : ["--reload", "--reload-dir", "api"]),
]);
const child = spawn(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
