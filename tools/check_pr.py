"""Validate pull request metadata as data, never as shell commands."""

import json
from pathlib import Path
import re
import sys


SECTIONS = ("Problem", "Approach", "Verification", "Risks and limitations")
TITLE = re.compile(
    r"^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)"
    r"(\([a-zA-Z0-9_./-]+\))?!?: \S[^\n]+$"
)


def validate(event):
    pr = event.get("pull_request", {})
    author = pr.get("user", {})
    if author.get("login") == "dependabot[bot]" and author.get("type") == "Bot":
        return []
    errors = []
    if not TITLE.fullmatch(pr.get("title") or ""):
        errors.append("Use a conventional title, such as feat(app): add demo flow.")
    body = re.sub(r"<!--.*?-->", "", pr.get("body") or "", flags=re.S)
    # Example references inside code fences do not establish traceability.
    prose = re.sub(r"(?ms)^(```|~~~).*?^\1[^\n]*", "", body)
    repository = event.get("repository", {}).get("full_name", "")
    reference = r"(?im)^\s*(?:refs?|closes?|fix(?:es)?|resolves?):?\s+#([1-9][0-9]*)\b"
    issue_url = rf"https://github\.com/{re.escape(repository)}/issues/[1-9][0-9]*(?![0-9A-Za-z])"
    if not re.search(reference, prose) and not (repository and re.search(issue_url, prose)):
        errors.append("Link a real issue in this repository using Refs #123 or its issue URL.")
    for section in SECTIONS:
        match = re.search(
            rf"(?im)^##\s+{re.escape(section)}\s*$\n?(.*?)(?=^##\s|\Z)",
            body,
            flags=re.S,
        )
        value = match.group(1).strip() if match else ""
        if not value or re.fullmatch(r"(?:TBD|TODO|N/?A|[-_.*\s]+)[.!]?", value, re.I):
            errors.append(f"Complete the {section} section with useful review evidence.")
    return errors


def main():
    if len(sys.argv) != 2:
        print("Usage: python tools/check_pr.py EVENT_JSON", file=sys.stderr)
        return 2
    event = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    errors = validate(event)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("Pull request evidence checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
