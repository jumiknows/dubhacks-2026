// Run offline Python regressions with the same interpreter as `npm run api`.
import { spawn } from "node:child_process";
import { pythonArgs, pythonBin, root } from "./python.mjs";

const child = spawn(pythonBin(), pythonArgs(["-B", "scripts/test_api.py", ...process.argv.slice(2)]), {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1",
    LLM_API_KEY: "", ELEVENLABS_API_KEY: "", GEMINI_API_KEY: "", STRIPE_SECRET_KEY: "", DEMO_SERVER_SIGNING: "false" },
});
child.on("error", () => { console.error("Could not start the API test interpreter."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
