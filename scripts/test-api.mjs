// Run offline Python regressions using the same project virtualenv as npm run api.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const python = join(root, "api", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error("API virtualenv not found. Run npm run api:setup first.");
  process.exit(1);
}
const child = spawn(python, ["-B", "scripts/test_api.py", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1",
    LLM_API_KEY: "", ELEVENLABS_API_KEY: "", STRIPE_SECRET_KEY: "", DEMO_SERVER_SIGNING: "false" },
});
child.on("error", () => { console.error("Could not start the API test interpreter."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
