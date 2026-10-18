"""Copy the verified application into an initialized Sites Vinext checkout."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
site = Path(sys.argv[1]).resolve()
manifest = site / ".openai/hosting.json"
if not manifest.exists() or not json.loads(manifest.read_text()).get("project_id"):
    raise SystemExit("Initialize the Sites checkout and persist its project ID first")
if not (root / "apps/web/src/lib/server/replay.generated.json").exists():
    raise SystemExit("Run npm run data:bundle first")
for folder in ["app", "components", "lib"]:
    target = site / folder
    if target.exists() and folder != "lib":
        shutil.rmtree(target)
    shutil.copytree(root / "apps/web/src" / folder, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns("*.test.ts"))
shutil.copytree(root / "apps/web/public", site / "public", dirs_exist_ok=True)
for package in ["domain", "data"]:
    shutil.copytree(root / "packages" / package / "src", site / "packages" / package, dirs_exist_ok=True, ignore=shutil.ignore_patterns("*.test.ts"))
for folder in ["places", "regions"]:
    shutil.copytree(root / "data" / folder, site / "data" / folder, dirs_exist_ok=True)
catalog = site / "lib/server/catalog.ts"
catalog.write_text(catalog.read_text().replace("../../../../../data/", "../../data/"))
vite = site / "vite.config.ts"
text = vite.read_text()
if "@emberready/domain" not in text:
    text = text.replace('    plugins: [', '    resolve: { alias: { "@emberready/domain": new URL("./packages/domain/index.ts", import.meta.url).pathname, "@emberready/data": new URL("./packages/data/index.ts", import.meta.url).pathname } },\n    plugins: [')
vite.write_text(text)
config = site / "tsconfig.json"
types = json.loads(config.read_text())
types["compilerOptions"].setdefault("paths", {}).update({"@emberready/domain": ["./packages/domain/index.ts"], "@emberready/data": ["./packages/data/index.ts"]})
config.write_text(json.dumps(types, indent=2) + "\n")
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
(site / "SOURCE_REVISION.json").write_text(json.dumps({"repository": "https://github.com/jumiknows/spacex2026Hacks", "baseCommit": commit, "workingTreeChangesIncluded": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=root, text=True).strip()), "snapshotId": json.loads((site / "lib/server/replay.generated.json").read_text())["manifest"]["snapshotId"]}, indent=2) + "\n")
print("Prepared application source in", site)
