from pathlib import Path
import tempfile
import unittest

from tools.check_pr import validate
from tools.check_repo import check_files


class RepositoryChecks(unittest.TestCase):
    def check(self, files, tracked=None):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            paths = [Path(name) for name in (tracked if tracked is not None else files)]
            return check_files(root, paths)

    def test_nested_document_and_encoded_filename_links(self):
        self.assertEqual([], self.check({
            "README.md": "[Guide](docs/guide.md#setup)",
            "docs/guide.md": "[Root](../README.md) [Notes](team%20notes.md)",
            "docs/team notes.md": "Notes",
        }))

    def test_broken_link_fails(self):
        self.assertTrue(self.check({"README.md": "[Guide](missing.md)"}))

    def test_untracked_existing_file_does_not_hide_broken_link(self):
        self.assertTrue(self.check(
            {"README.md": "[Guide](local.md)", "local.md": "Local only"},
            tracked=["README.md"],
        ))

    def test_external_links_and_code_examples_are_ignored(self):
        self.assertEqual([], self.check({
            "README.md": "[Site](https://example.com)\n```md\n[Example](missing.md)\n```\n",
        }))

    def test_environment_examples_are_allowed_but_local_values_fail(self):
        self.assertEqual([], self.check({"apps/web/.env.example": "PORT=3000"}))
        self.assertTrue(self.check({"apps/web/.env.local": "PORT=3000"}))

    def test_generated_files_fail(self):
        self.assertTrue(self.check({"apps/web/node_modules/package.json": "{}"}))

    def test_merge_conflicts_fail(self):
        self.assertTrue(self.check({"README.md": "<<<<<<< HEAD\nUnresolved\n"}))

    def test_invalid_json_and_duplicate_labels_fail(self):
        self.assertTrue(self.check({"settings.json": "{"}))
        self.assertTrue(self.check({".github/labels.json": '[{"name":"x"},{"name":"x"}]'}))

    def test_link_outside_repository_fails(self):
        self.assertTrue(self.check({"README.md": "[Outside](../outside.md)"}))


class PullRequestChecks(unittest.TestCase):
    def event(self, body=None):
        return {
            "repository": {"full_name": "jumiknows/spacex2026Hacks"},
            "pull_request": {
                "title": "fix(app): handle an empty result",
                "user": {"login": "contributor", "type": "User"},
                "body": body if body is not None else (
                    "Refs #12\n\n## Problem\nEmpty results cause a crash.\n\n"
                    "## Approach\nShow the empty state.\n\n"
                    "## Verification\nRan the empty-result regression test successfully.\n\n"
                    "## Risks and limitations\nNone identified.\n"
                ),
            },
        }

    def test_complete_evidence_passes(self):
        self.assertEqual([], validate(self.event()))

    def test_bad_title_fails(self):
        event = self.event()
        event["pull_request"]["title"] = "updates"
        self.assertTrue(validate(event))

    def test_unfilled_template_fails(self):
        template = Path(".github/pull_request_template.md").read_text(encoding="utf-8")
        self.assertEqual(5, len(validate(self.event(template))))

    def test_commented_or_example_reference_does_not_count(self):
        for reference in ("<!-- Refs #12 -->", "```text\nRefs #12\n```"):
            event = self.event()
            event["pull_request"]["body"] = event["pull_request"]["body"].replace("Refs #12", reference)
            self.assertTrue(validate(event))

    def test_same_repository_issue_url_passes(self):
        event = self.event()
        event["pull_request"]["body"] = event["pull_request"]["body"].replace(
            "Refs #12", "Issue: https://github.com/jumiknows/spacex2026Hacks/issues/12"
        )
        self.assertEqual([], validate(event))

    def test_other_repository_issue_url_does_not_count(self):
        event = self.event()
        event["pull_request"]["body"] = event["pull_request"]["body"].replace(
            "Refs #12", "https://github.com/someone/else/issues/12"
        )
        self.assertTrue(validate(event))

    def test_placeholder_verification_fails(self):
        event = self.event()
        event["pull_request"]["body"] = event["pull_request"]["body"].replace(
            "Ran the empty-result regression test successfully.", "TODO"
        )
        self.assertTrue(validate(event))

    def test_only_the_dependabot_bot_is_exempt(self):
        event = self.event("")
        event["pull_request"]["user"] = {"login": "dependabot[bot]", "type": "Bot"}
        self.assertEqual([], validate(event))
        event["pull_request"]["user"]["type"] = "User"
        self.assertTrue(validate(event))


if __name__ == "__main__":
    unittest.main()
