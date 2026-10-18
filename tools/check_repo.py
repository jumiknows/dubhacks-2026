"""Check tracked repository files without third-party dependencies."""

import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit


GENERATED = {"node_modules", ".venv", "venv", "__pycache__", ".next", ".turbo"}
LINK = re.compile(r"!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+\"[^\"]*\")?\)")


def tracked_paths(root):
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True
    )
    return [Path(name.decode("utf-8")) for name in result.stdout.split(b"\0") if name]


def check_files(root, paths):
    root = root.resolve()
    tracked = {path.as_posix() for path in paths}
    errors = []
    for relative in paths:
        name = relative.name
        if GENERATED.intersection(relative.parts):
            errors.append(f"{relative}: generated dependency files must not be tracked")
        if (name == ".env" or name.startswith(".env.")) and not name.endswith(".example"):
            errors.append(f"{relative}: track an example environment file instead")
            continue
        path = root / relative
        if not path.resolve().is_relative_to(root):
            errors.append(f"{relative}: tracked path resolves outside the repository")
            continue
        if not path.is_file():
            errors.append(f"{relative}: tracked file is missing")
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if re.search(r"(?m)^(<<<<<<< |>>>>>>> )", content):
            errors.append(f"{relative}: unresolved merge conflict")
        if relative.suffix == ".json":
            try:
                data = json.loads(content)
                if relative.as_posix() == ".github/labels.json":
                    names = [label["name"] for label in data]
                    if len(names) != len(set(names)):
                        raise ValueError("duplicate label names")
                    for label in data:
                        if not re.fullmatch(r"[0-9A-Fa-f]{6}", label["color"]):
                            raise ValueError("label colors must be six hex digits")
            except (ValueError, KeyError, TypeError) as error:
                errors.append(f"{relative}: invalid JSON or label configuration ({error})")
        if relative.suffix.lower() != ".md":
            continue
        prose = re.sub(r"(?ms)^(```|~~~).*?^\1[^\n]*", "", content)
        for match in LINK.finditer(prose):
            target = match.group(1).strip("<>")
            url = urlsplit(target)
            if url.scheme or url.netloc or not url.path:
                continue
            decoded = unquote(url.path)
            linked = root / decoded.lstrip("/") if decoded.startswith("/") else path.parent / decoded
            try:
                local = linked.resolve().relative_to(root).as_posix()
            except ValueError:
                errors.append(f"{relative}: link escapes the repository: {target}")
                continue
            is_tracked = local in tracked or any(item.startswith(local + "/") for item in tracked)
            if local != "." and not is_tracked:
                errors.append(f"{relative}: missing tracked link target: {target}")
    return errors


def main():
    root = Path(__file__).resolve().parents[1]
    paths = tracked_paths(root)
    errors = check_files(root, paths)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Repository checks passed for {len(paths)} tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
