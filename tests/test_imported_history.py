import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from tools.check_imported_history import check_history


class ImportedHistoryChecks(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name)
        self.run_git("init", "-q")
        (self.repo / "app.txt").write_text("application\n", encoding="utf-8")
        self.run_git("add", "app.txt")
        self.run_git("commit", "-qm", "original application")
        self.original = self.run_git("rev-parse", "HEAD")

    def run_git(self, *args, input=None):
        result = subprocess.run(
            ["git", "-c", "core.hooksPath=/dev/null", *args],
            cwd=self.repo, text=True, input=input, capture_output=True, check=True,
            env={**os.environ, "GIT_AUTHOR_NAME": "History Test", "GIT_AUTHOR_EMAIL": "history@example.test",
                 "GIT_COMMITTER_NAME": "History Test", "GIT_COMMITTER_EMAIL": "history@example.test",
                 "GIT_CONFIG_NOSYSTEM": "1"},
        )
        return result.stdout.strip()

    def manifest(self, *commits):
        return {"schema_version": 1, "commit_count": len(commits), "original_commits": list(commits)}

    def test_original_ancestor_survives_later_application_changes(self):
        (self.repo / "app.txt").write_text("integrated application\n", encoding="utf-8")
        self.run_git("commit", "-qam", "integrate backend")
        self.assertEqual([], check_history(self.repo, self.manifest(self.original)))

    def test_same_files_on_an_unrelated_commit_do_not_preserve_history(self):
        original_tree = self.run_git("rev-parse", "HEAD^{tree}")
        self.run_git("checkout", "--orphan", "rewritten", "-q")
        self.run_git("commit", "-qm", "copy application without its history")
        self.assertEqual(original_tree, self.run_git("rev-parse", "HEAD^{tree}"))
        errors = check_history(self.repo, self.manifest(self.original))
        self.assertEqual(1, len(errors))
        self.assertIn("not an ancestor", errors[0])

    def test_missing_object_and_noncommit_object_fail(self):
        blob = self.run_git("hash-object", "-w", "--stdin", input="not a commit")
        errors = check_history(self.repo, self.manifest("0" * 40, blob))
        self.assertEqual(2, len(errors))
        self.assertTrue(all("missing or is not a commit" in error for error in errors))

    def test_invalid_manifest_cannot_report_success(self):
        for manifest in (
            {}, self.manifest(), self.manifest(self.original, self.original),
            {**self.manifest(self.original), "commit_count": 2}, self.manifest("HEAD"),
        ):
            with self.subTest(manifest=manifest):
                self.assertTrue(check_history(self.repo, manifest))

    def test_git_replace_cannot_fake_original_ancestry(self):
        self.run_git("checkout", "--orphan", "replacement", "-q")
        self.run_git("commit", "-qm", "different root")
        unrelated = self.run_git("rev-parse", "HEAD")
        self.run_git("replace", "--graft", unrelated, self.original)
        self.run_git("merge-base", "--is-ancestor", self.original, "HEAD")
        self.assertTrue(check_history(self.repo, self.manifest(self.original)))


if __name__ == "__main__":
    unittest.main()
