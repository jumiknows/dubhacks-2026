"""Verify that the original SpaceX commits remain ancestors of the integrated app."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def git(repo, *args):
    return subprocess.run(
        ["git", *args], cwd=repo, text=True, capture_output=True,
        env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"},
    )


def check_history(repo, manifest, ref="HEAD"):
    errors = []
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        return ["History manifest must use schema_version 1."]
    commits = manifest.get("original_commits")
    if not isinstance(commits, list) or not commits:
        return ["History manifest must contain the original commit IDs."]
    if any(not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit) for commit in commits):
        return ["Original commits must be full lowercase SHA-1 commit IDs."]
    if len(commits) != len(set(commits)):
        errors.append("History manifest contains duplicate commit IDs.")
    if type(manifest.get("commit_count")) is not int or manifest["commit_count"] != len(commits):
        errors.append("History manifest commit_count does not match its commit list.")
    if errors:
        return errors
    target = git(repo, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}")
    if target.returncode:
        return [f"Integrated ref is not a readable commit: {ref}"]
    head = target.stdout.strip()
    for commit in commits:
        kind = git(repo, "cat-file", "-t", commit)
        if kind.returncode or kind.stdout.strip() != "commit":
            errors.append(f"Original commit is missing or is not a commit: {commit}")
            continue
        ancestor = git(repo, "merge-base", "--is-ancestor", commit, head)
        if ancestor.returncode == 1:
            errors.append(f"Original commit is not an ancestor of {ref}: {commit}")
        elif ancestor.returncode:
            errors.append(f"Could not verify original commit ancestry: {commit}")
    return errors


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=root)
    parser.add_argument("--manifest", type=Path, default=root / "docs/integration/source-history.json")
    parser.add_argument("--ref", default="HEAD")
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        errors = check_history(args.repo, manifest, args.ref)
    except (OSError, ValueError) as error:
        errors = [f"Could not read imported history: {error}"]
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Imported history verified: {manifest['commit_count']} original commits are ancestors of {args.ref}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
