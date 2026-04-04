from __future__ import annotations

import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_UI_DIR = ROOT / "tools" / "webui"


class _AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.refs: list[str] = []
        self.ids: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = dict(attrs)
        element_id = attr_map.get("id")
        if element_id:
            self.ids.add(element_id)
        if tag == "link" and attr_map.get("rel") == "stylesheet" and attr_map.get("href"):
            self.refs.append(attr_map["href"])
        if tag == "script" and attr_map.get("src"):
            self.refs.append(attr_map["src"])


class WebUiAssetTests(unittest.TestCase):
    def _resolve_static_path(self, url_path: str) -> Path | None:
        relative = "index.html" if url_path == "/" else url_path.removeprefix("/assets/")
        candidate = (WEB_UI_DIR / relative).resolve()
        web_root = WEB_UI_DIR.resolve()
        try:
            candidate.relative_to(web_root)
        except ValueError:
            return None
        if not candidate.is_file():
            return None
        return candidate

    def _index_asset_refs(self) -> list[str]:
        parser = _AssetParser()
        parser.feed((WEB_UI_DIR / "index.html").read_text(encoding="utf-8"))
        return parser.refs

    def _index_element_ids(self) -> set[str]:
        parser = _AssetParser()
        parser.feed((WEB_UI_DIR / "index.html").read_text(encoding="utf-8"))
        return parser.ids

    def test_index_references_only_served_assets(self) -> None:
        refs = self._index_asset_refs()
        self.assertGreater(len(refs), 0, "index.html should reference at least one asset")

        for ref in refs:
            with self.subTest(ref=ref):
                self.assertTrue(ref.startswith("/assets/"), f"{ref} must be served from /assets/")
                resolved = self._resolve_static_path(ref)
                self.assertIsNotNone(resolved, f"{ref} should resolve through kserver")
                self.assertTrue(resolved.is_file(), f"{ref} should exist on disk")

    def test_root_route_serves_index_html(self) -> None:
        resolved = self._resolve_static_path("/")
        self.assertEqual(resolved, WEB_UI_DIR / "index.html")

    def test_static_path_rejects_traversal(self) -> None:
        self.assertIsNone(self._resolve_static_path("/assets/../kserver.py"))

    def test_editor_exposes_exit_skill_mode_control(self) -> None:
        self.assertIn("exitSkillModeButton", self._index_element_ids())

    def test_app_wires_exit_skill_mode_handler(self) -> None:
        app_js = (WEB_UI_DIR / "app.js").read_text(encoding="utf-8")
        self.assertIn("function exitSkillMode()", app_js)
        self.assertIn('els.exitSkillModeButton.addEventListener("click", exitSkillMode);', app_js)


if __name__ == "__main__":
    unittest.main()
