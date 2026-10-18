import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps", "web");
const require = createRequire(join(web, "package.json"));
const next = require.resolve("next/dist/bin/next");
const mode = process.argv.includes("--dev") ? "dev" : "start";
const child = spawn(process.execPath, [next, mode, "--hostname", "127.0.0.1", "--port", process.env.NEXT_PORT || "3000"], {
  cwd: web,
  stdio: "inherit",
  env: process.env,
});
child.on("error", () => { console.error("Could not start the web application."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 0; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
