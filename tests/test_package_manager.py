from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.package_manager import PackageManager


class PackageManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.builtin_skills = self.root / "builtin-skills"
        self.builtin_libraries = self.root / "builtin-libraries"
        self.local_skills = self.root / "local-skills"
        self.local_libraries = self.root / "local-libraries"
        self.packages = self.root / "packages"
        self.builtin_skills.mkdir(parents=True)
        self.builtin_libraries.mkdir(parents=True)
        self.local_skills.mkdir(parents=True)
        self.local_libraries.mkdir(parents=True)
        self.packages.mkdir(parents=True)
        self.manager = PackageManager(
            builtin_skills_dir=self.builtin_skills,
            builtin_libraries_dir=self.builtin_libraries,
            local_skills_dir=self.local_skills,
            local_libraries_dir=self.local_libraries,
            packages_dir=self.packages,
        )

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def _write_builtin_skill(self, skill_id: str, *, name: str) -> None:
        (self.builtin_skills / f"{skill_id}.js").write_text("module.exports = {};\n", encoding="utf-8")
        (self.builtin_skills / f"{skill_id}.json").write_text(json.dumps({
            "id": skill_id,
            "name": name,
            "summary": "built-in",
            "runtime": "jscbridge",
            "executionMode": "interactive",
            "entryFile": f"{skill_id}.js",
            "inputs": [],
        }, indent=2) + "\n", encoding="utf-8")

    def _write_builtin_library(self, library_id: str, *, module_id: str) -> None:
        (self.builtin_libraries / f"{library_id}.js").write_text("module.exports = { answer: 42 };\n", encoding="utf-8")
        (self.builtin_libraries / f"{library_id}.json").write_text(json.dumps({
            "id": library_id,
            "name": "Test Library",
            "summary": "library summary",
            "entryFile": f"{library_id}.js",
            "moduleId": module_id,
            "exposureMode": "hybrid",
            "namespace": library_id,
            "enabledByDefault": True,
            "apiReference": [
                {
                    "name": f"Libraries.{library_id}.answer",
                    "signature": f"Libraries.{library_id}.answer",
                    "category": "Libraries",
                    "description": "Answer constant",
                    "snippet": f"log(String(Libraries.{library_id}.answer));",
                }
            ],
        }, indent=2) + "\n", encoding="utf-8")

    def test_save_skill_writes_to_local_storage(self) -> None:
        self._write_builtin_skill("builtin-skill", name="Builtin Skill")

        saved = self.manager.save_skill({
            "name": "Local Skill",
            "summary": "local summary",
            "runtime": "jscbridge",
            "executionMode": "interactive",
            "inputs": [],
            "code": "log('ok');\n",
            "entryFile": "local-skill.js",
            "libraryDependencies": ["darkforge/zip"],
        })

        self.assertEqual(saved["sourceType"], "local")
        self.assertEqual(saved["libraryDependencies"], ["darkforge/zip"])
        self.assertTrue((self.local_skills / "local-skill.json").is_file())
        self.assertTrue((self.local_skills / "local-skill.js").is_file())
        listed = self.manager.list_skills()
        self.assertEqual({item["sourceType"] for item in listed}, {"builtin", "local"})

    def test_preprocess_code_registers_runtime_loader_and_library(self) -> None:
        self._write_builtin_library("zip", module_id="darkforge/zip")

        processed = self.manager.preprocess_code('const zip = require("darkforge/zip");\nlog(String(zip.answer));\n')

        self.assertIn("__darkforgeRuntime", processed)
        self.assertIn('require("darkforge/zip")', processed)
        self.assertIn("globalThis.Libraries[meta.namespace] = value", processed)
        self.assertIn("module.exports = { answer: 42 }", processed)

    def test_set_library_enabled_updates_package_state(self) -> None:
        package_dir = self.packages / "sample-package"
        source_dir = package_dir / "source" / "libraries"
        source_dir.mkdir(parents=True)
        (source_dir / "util.js").write_text("module.exports = { enabled: true };\n", encoding="utf-8")
        (source_dir / "util.json").write_text(json.dumps({
            "id": "util",
            "name": "Utility",
            "summary": "linked library",
            "entryFile": "util.js",
            "moduleId": "sample-package/util",
            "exposureMode": "module",
            "enabledByDefault": True,
            "apiReference": [
                {
                    "name": "util.enabled",
                    "signature": "util.enabled",
                    "category": "Libraries",
                    "description": "Read the enabled marker from the sample util module",
                    "snippet": "const util = require(\"sample-package/util\");",
                }
            ],
        }, indent=2) + "\n", encoding="utf-8")
        (package_dir / "package-install.json").write_text(json.dumps({
            "package": {
                "id": "sample-package",
                "name": "Sample Package",
                "summary": "",
                "author": "",
                "homepage": "",
                "skills": [],
                "libraries": [{"id": "util", "manifestPath": "libraries/util.json"}],
            },
            "source": {
                "repoUrl": "https://github.com/example/sample-package",
                "ref": "main",
                "resolvedCommit": "abc123",
                "subpath": "",
            },
            "skills": [],
            "libraries": [{"id": "util", "manifestPath": "libraries/util.json"}],
            "libraryState": {"sample-package/util": True},
            "installedAt": "2026-01-01T00:00:00+00:00",
            "updatedAt": "2026-01-01T00:00:00+00:00",
        }, indent=2) + "\n", encoding="utf-8")

        updated = self.manager.set_library_enabled("sample-package/util", False)

        self.assertFalse(updated["enabled"])
        stored = json.loads((package_dir / "package-install.json").read_text(encoding="utf-8"))
        self.assertFalse(stored["libraryState"]["sample-package/util"])

    def test_preview_and_install_local_repo_source(self) -> None:
        repo_root = self.root / "local-repo"
        (repo_root / "skills").mkdir(parents=True)
        (repo_root / "libraries").mkdir(parents=True)
        (repo_root / "darkforge-package.json").write_text(json.dumps({
            "schemaVersion": 1,
            "package": {
                "id": "local-repo",
                "name": "Local Repo",
                "summary": "local package",
                "author": "tester",
                "homepage": ""
            },
            "skills": [
                {"id": "hello", "manifestPath": "skills/hello.json"}
            ],
            "libraries": [
                {"id": "zip", "manifestPath": "libraries/zip.json"}
            ]
        }, indent=2) + "\n", encoding="utf-8")
        (repo_root / "skills" / "hello.json").write_text(json.dumps({
            "id": "hello",
            "name": "Hello",
            "summary": "local skill",
            "runtime": "jscbridge",
            "executionMode": "interactive",
            "entryFile": "hello.js",
            "libraryDependencies": ["local-repo/zip"],
            "inputs": []
        }, indent=2) + "\n", encoding="utf-8")
        (repo_root / "skills" / "hello.js").write_text("log('hello');\n", encoding="utf-8")
        (repo_root / "libraries" / "zip.json").write_text(json.dumps({
            "id": "zip",
            "name": "ZIP",
            "summary": "local zip",
            "entryFile": "zip.js",
            "moduleId": "local-repo/zip",
            "exposureMode": "module",
            "enabledByDefault": True,
            "apiReference": [
                {
                    "name": "zip.enabled",
                    "signature": "zip.enabled",
                    "category": "Libraries",
                    "description": "Read the local zip module marker",
                    "snippet": "const zip = require(\"local-repo/zip\");",
                }
            ],
        }, indent=2) + "\n", encoding="utf-8")
        (repo_root / "libraries" / "zip.js").write_text("module.exports = { enabled: true };\n", encoding="utf-8")

        preview = self.manager.preview_package(str(repo_root))
        installed = self.manager.install_package(str(repo_root))
        packages = self.manager.list_packages()
        update = self.manager.check_package_update("local-repo")

        self.assertEqual(preview["source"]["sourceKind"], "local")
        self.assertEqual(preview["source"]["sourcePath"], str(repo_root.resolve()))
        self.assertEqual(installed["source"]["sourceKind"], "local")
        self.assertEqual(packages[0]["sourceKind"], "local")
        self.assertFalse(update["hasUpdate"])

    def test_api_reference_rejects_require_rows(self) -> None:
        (self.builtin_libraries / "bad.js").write_text("module.exports = {};\n", encoding="utf-8")
        (self.builtin_libraries / "bad.json").write_text(json.dumps({
            "id": "bad",
            "name": "Bad Library",
            "summary": "invalid docs",
            "entryFile": "bad.js",
            "moduleId": "bad/library",
            "exposureMode": "module",
            "enabledByDefault": True,
            "apiReference": [
                {
                    "name": "require(\"bad/library\")",
                    "signature": "const bad = require(\"bad/library\")",
                    "category": "Libraries",
                    "description": "invalid import row",
                    "snippet": "const bad = require(\"bad/library\");",
                }
            ],
        }, indent=2) + "\n", encoding="utf-8")

        libraries = self.manager.list_libraries()
        self.assertEqual(libraries, [])


if __name__ == "__main__":
    unittest.main()
