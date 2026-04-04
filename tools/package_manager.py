from __future__ import annotations

import hashlib
import json
import posixpath
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


PACKAGE_INDEX_NAME = "darkforge-package.json"
DEFAULT_SKILL_RUNTIME = "jscbridge"
VALID_SKILL_RUNTIMES = {DEFAULT_SKILL_RUNTIME}
VALID_SKILL_INPUT_TYPES = {"text", "boolean", "select", "app"}
VALID_SKILL_EXECUTION_MODES = {"interactive", "job"}
VALID_LIBRARY_EXPOSURE_MODES = {"global", "module", "hybrid"}
APP_SUPPORT_ROOT = Path.home() / "Library" / "Application Support" / "DarkForge"
HOST_SUPPORT_ROOT = APP_SUPPORT_ROOT / "host"
HOST_LOCAL_SKILLS_DIR = HOST_SUPPORT_ROOT / "skills"
HOST_LOCAL_LIBRARIES_DIR = HOST_SUPPORT_ROOT / "libraries"
HOST_PACKAGES_DIR = HOST_SUPPORT_ROOT / "packages"


class PackageError(ValueError):
    """Raised when a package source or manifest is invalid."""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slugify(value: str, *, prefix: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", str(value).strip().lower()).strip("-")
    return slug or f"{prefix}-{hashlib.sha1(str(value).encode('utf-8')).hexdigest()[:8]}"


def _normalize_rel_path(value: Any, *, allow_empty: bool = False) -> str:
    raw = str(value or "").strip().replace("\\", "/")
    if not raw:
        if allow_empty:
            return ""
        raise PackageError("Path must not be empty")
    normalized = str(PurePosixPath(raw))
    if normalized in {"", "."}:
        if allow_empty:
            return ""
        raise PackageError("Path must not be empty")
    if normalized.startswith("../") or normalized == ".." or "/../" in f"/{normalized}":
        raise PackageError(f"Path escaped package root: {value}")
    return normalized.lstrip("/")


def _normalize_entry_file(entry_file: Any) -> str:
    normalized = _normalize_rel_path(entry_file)
    if not normalized.endswith(".js"):
        raise PackageError("entryFile must point to a .js file")
    return normalized


def _normalize_string_list(values: Any) -> list[str]:
    if values is None:
        return []
    if not isinstance(values, list):
        raise PackageError("Expected an array of strings")
    normalized: list[str] = []
    for item in values:
        text = str(item or "").strip()
        if text:
            normalized.append(text)
    return normalized


def _normalize_skill_inputs(raw_inputs: Any) -> list[dict[str, Any]]:
    if raw_inputs in (None, ""):
        return []
    if not isinstance(raw_inputs, list):
        raise PackageError("Skill inputs must be an array")
    normalized: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for raw in raw_inputs:
        if not isinstance(raw, dict):
            raise PackageError("Skill input entries must be objects")
        input_id = slugify(str(raw.get("id", "")).strip(), prefix="input")
        if input_id in seen_ids:
            raise PackageError(f"Duplicate skill input id: {input_id}")
        seen_ids.add(input_id)
        input_type = str(raw.get("type") or "text").strip().lower()
        if input_type not in VALID_SKILL_INPUT_TYPES:
            raise PackageError(f"Unsupported skill input type: {input_type}")
        entry: dict[str, Any] = {
            "id": input_id,
            "label": str(raw.get("label") or input_id).strip() or input_id,
            "type": input_type,
            "required": bool(raw.get("required", False)),
        }
        if "defaultValue" in raw:
            entry["defaultValue"] = raw.get("defaultValue")
        if raw.get("placeholder") not in (None, ""):
            entry["placeholder"] = str(raw.get("placeholder"))
        if input_type == "select":
            options = raw.get("options") or []
            if not isinstance(options, list) or not options:
                raise PackageError("Select inputs must declare at least one option")
            normalized_options: list[dict[str, str]] = []
            for option in options:
                if isinstance(option, str):
                    label = option.strip()
                    if not label:
                        continue
                    normalized_options.append({"value": label, "label": label})
                    continue
                if not isinstance(option, dict):
                    raise PackageError("Select input options must be strings or objects")
                value = str(option.get("value") or "").strip()
                if not value:
                    raise PackageError("Select option value must not be empty")
                label = str(option.get("label") or value).strip() or value
                normalized_options.append({"value": value, "label": label})
            if not normalized_options:
                raise PackageError("Select inputs must declare at least one option")
            entry["options"] = normalized_options
        normalized.append(entry)
    return normalized


def _normalize_api_reference(raw_entries: Any) -> list[dict[str, str]]:
    if raw_entries in (None, ""):
        return []
    if not isinstance(raw_entries, list):
        raise PackageError("apiReference must be an array")
    entries: list[dict[str, str]] = []
    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise PackageError("apiReference entries must be objects")
        name = str(raw.get("name") or "").strip()
        signature = str(raw.get("signature") or name).strip()
        description = str(raw.get("description") or "").strip()
        snippet = str(raw.get("snippet") or "").strip()
        category = str(raw.get("category") or "Libraries").strip() or "Libraries"
        if not name or not signature or not description or not snippet:
            raise PackageError("apiReference entries require name, signature, description, and snippet")
        entries.append({
            "name": name,
            "signature": signature,
            "description": description,
            "snippet": snippet,
            "category": category,
        })
    return entries


@dataclass
class SkillRecord:
    id: str
    source_type: str
    manifest_path: Path
    entry_path: Path | None
    code: str
    payload: dict[str, Any]

    def to_summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.payload.get("name", self.id),
            "summary": self.payload.get("summary", ""),
            "runtime": self.payload.get("runtime", DEFAULT_SKILL_RUNTIME),
            "executionMode": self.payload.get("executionMode", "interactive"),
            "inputCount": len(self.payload.get("inputs", [])),
            "entryFile": self.payload.get("entryFile", ""),
            "createdAt": self.payload.get("createdAt"),
            "updatedAt": self.payload.get("updatedAt"),
            "sourceType": self.source_type,
            "readOnly": self.source_type != "local",
            "packageId": self.payload.get("packageId"),
            "packageName": self.payload.get("packageName"),
            "provenance": self.payload.get("provenance"),
            "libraryDependencies": list(self.payload.get("libraryDependencies", [])),
        }

    def to_detail(self) -> dict[str, Any]:
        detail = dict(self.to_summary())
        detail["code"] = self.code
        detail["inputs"] = list(self.payload.get("inputs", []))
        return detail


@dataclass
class LibraryRecord:
    id: str
    source_type: str
    manifest_path: Path
    entry_path: Path | None
    code: str
    payload: dict[str, Any]

    def to_summary(self) -> dict[str, Any]:
        return {
            "id": self.payload["id"],
            "name": self.payload["name"],
            "summary": self.payload.get("summary", ""),
            "version": self.payload.get("version", ""),
            "entryFile": self.payload.get("entryFile", ""),
            "moduleId": self.payload["moduleId"],
            "namespace": self.payload.get("namespace"),
            "dependencies": list(self.payload.get("dependencies", [])),
            "enabled": bool(self.payload.get("enabled", False)),
            "enabledByDefault": bool(self.payload.get("enabledByDefault", False)),
            "exposureMode": self.payload["exposureMode"],
            "sourceType": self.source_type,
            "readOnly": self.source_type != "local",
            "packageId": self.payload.get("packageId"),
            "packageName": self.payload.get("packageName"),
            "provenance": self.payload.get("provenance"),
            "exports": list(self.payload.get("exports", [])),
            "apiReference": list(self.payload.get("apiReference", [])),
        }


class GithubPackageFetcher:
    def __init__(self, source: str):
        self.source = str(source or "").strip()
        if not self.source:
            raise PackageError("Package source must not be empty")
        self.owner: str
        self.repo: str
        self.ref: str
        self.subpath: str
        self.repo_url: str
        self._commit_sha: str | None = None
        self._cache: dict[str, bytes] = {}
        self.owner, self.repo, self.ref, self.subpath = self._parse_source(self.source)
        self.repo_url = f"https://github.com/{self.owner}/{self.repo}"

    @staticmethod
    def _parse_source(source: str) -> tuple[str, str, str, str]:
        parsed = urlparse(source)
        if parsed.scheme in {"http", "https"}:
            if parsed.netloc not in {"github.com", "www.github.com"}:
                raise PackageError("Only public GitHub package sources are supported in v1")
            parts = [part for part in parsed.path.strip("/").split("/") if part]
            if len(parts) < 2:
                raise PackageError("GitHub source must include owner and repo")
            owner, repo = parts[0], parts[1]
            ref = "HEAD"
            subpath = ""
            if len(parts) >= 4 and parts[2] == "tree":
                ref = parts[3]
                if len(parts) > 4:
                    subpath = "/".join(parts[4:])
            return owner, repo, ref, _normalize_rel_path(subpath, allow_empty=True)
        shorthand = source.strip().strip("/")
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9._/-]+))?", shorthand)
        if not match:
            raise PackageError("Package source must be a GitHub URL or owner/repo[@ref]")
        owner, repo, ref = match.groups()
        return owner, repo, ref or "HEAD", ""

    def _fetch_json(self, url: str) -> dict[str, Any]:
        request = Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "DarkForge/1.0"})
        try:
            with urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise PackageError(f"GitHub request failed ({error.code}): {url}") from error
        except URLError as error:
            raise PackageError(f"GitHub request failed: {error.reason}") from error

    def resolve_commit(self) -> str:
        if self._commit_sha:
            return self._commit_sha
        url = f"https://api.github.com/repos/{quote(self.owner)}/{quote(self.repo)}/commits/{quote(self.ref, safe='')}"
        payload = self._fetch_json(url)
        sha = str(payload.get("sha") or "").strip()
        if not sha:
            raise PackageError("GitHub commit response did not include a commit SHA")
        self._commit_sha = sha
        return sha

    def fetch_bytes(self, relative_path: str) -> bytes:
        normalized = _normalize_rel_path(relative_path)
        if normalized in self._cache:
            return self._cache[normalized]
        commit = self.resolve_commit()
        full_path = normalized
        if self.subpath:
            full_path = posixpath.join(self.subpath, normalized)
        url = f"https://raw.githubusercontent.com/{quote(self.owner)}/{quote(self.repo)}/{quote(commit, safe='')}/{full_path}"
        request = Request(url, headers={"User-Agent": "DarkForge/1.0"})
        try:
            with urlopen(request, timeout=20) as response:
                data = response.read()
        except HTTPError as error:
            raise PackageError(f"GitHub file not found ({error.code}): {full_path}") from error
        except URLError as error:
            raise PackageError(f"GitHub file fetch failed: {error.reason}") from error
        self._cache[normalized] = data
        return data

    def fetch_text(self, relative_path: str) -> str:
        try:
            return self.fetch_bytes(relative_path).decode("utf-8")
        except UnicodeDecodeError as error:
            raise PackageError(f"Package file must be UTF-8 text: {relative_path}") from error

    def fetch_json_file(self, relative_path: str) -> dict[str, Any]:
        try:
            return json.loads(self.fetch_text(relative_path))
        except json.JSONDecodeError as error:
            raise PackageError(f"Invalid JSON file: {relative_path}") from error


class PackageManager:
    def __init__(
        self,
        *,
        builtin_skills_dir: Path,
        builtin_libraries_dir: Path,
        local_skills_dir: Path | None = None,
        local_libraries_dir: Path | None = None,
        packages_dir: Path | None = None,
    ):
        self.builtin_skills_dir = Path(builtin_skills_dir).resolve()
        self.builtin_libraries_dir = Path(builtin_libraries_dir).resolve()
        self.local_skills_dir = Path(local_skills_dir or HOST_LOCAL_SKILLS_DIR).resolve()
        self.local_libraries_dir = Path(local_libraries_dir or HOST_LOCAL_LIBRARIES_DIR).resolve()
        self.packages_dir = Path(packages_dir or HOST_PACKAGES_DIR).resolve()
        self.ensure_storage()

    def ensure_storage(self) -> None:
        self.local_skills_dir.mkdir(parents=True, exist_ok=True)
        self.local_libraries_dir.mkdir(parents=True, exist_ok=True)
        self.packages_dir.mkdir(parents=True, exist_ok=True)
        self.builtin_libraries_dir.mkdir(parents=True, exist_ok=True)

    def _skill_file(self, skill_id: str) -> Path:
        safe_id = slugify(skill_id, prefix="skill")
        return self.local_skills_dir / f"{safe_id}.json"

    def _library_file(self, library_id: str) -> Path:
        safe_id = slugify(library_id, prefix="library")
        return self.local_libraries_dir / f"{safe_id}.json"

    @staticmethod
    def _entry_path(base_dir: Path, entry_file: str) -> Path:
        normalized = _normalize_entry_file(entry_file)
        candidate = (base_dir / normalized).resolve()
        if not candidate.is_relative_to(base_dir.resolve()):
            raise PackageError("entryFile escaped its manifest directory")
        return candidate

    def _load_skill_manifest(self, raw_payload: dict[str, Any], *, manifest_path: Path, source_type: str, package_meta: dict[str, Any] | None = None) -> SkillRecord:
        payload = self._normalize_skill_payload(raw_payload, manifest_path=manifest_path, package_meta=package_meta)
        skill_id = slugify(str(payload.get("id") or manifest_path.stem), prefix="skill")
        entry_path = self._entry_path(manifest_path.parent, payload["entryFile"]) if payload["entryFile"] else None
        code = payload["code"]
        return SkillRecord(
            id=skill_id,
            source_type=source_type,
            manifest_path=manifest_path,
            entry_path=entry_path,
            code=code,
            payload=payload,
        )

    def _load_library_manifest(self, raw_payload: dict[str, Any], *, manifest_path: Path, source_type: str, package_meta: dict[str, Any] | None = None, enabled: bool | None = None) -> LibraryRecord:
        payload = self._normalize_library_payload(raw_payload, manifest_path=manifest_path, package_meta=package_meta, enabled=enabled)
        entry_path = self._entry_path(manifest_path.parent, payload["entryFile"]) if payload["entryFile"] else None
        code = payload["code"]
        return LibraryRecord(
            id=payload["id"],
            source_type=source_type,
            manifest_path=manifest_path,
            entry_path=entry_path,
            code=code,
            payload=payload,
        )

    def _normalize_skill_payload(self, raw_payload: dict[str, Any], *, manifest_path: Path, package_meta: dict[str, Any] | None = None) -> dict[str, Any]:
        if not isinstance(raw_payload, dict):
            raise PackageError("Skill manifest must be an object")
        entry_file = _normalize_entry_file(raw_payload.get("entryFile")) if raw_payload.get("entryFile") else ""
        code = str(raw_payload.get("code") or "")
        if entry_file:
            code_path = self._entry_path(manifest_path.parent, entry_file)
            code = code_path.read_text(encoding="utf-8") if code_path.exists() else code
        runtime = str(raw_payload.get("runtime") or DEFAULT_SKILL_RUNTIME).strip().lower()
        if runtime not in VALID_SKILL_RUNTIMES:
            raise PackageError(f"Unsupported skill runtime: {runtime}")
        execution_mode = str(raw_payload.get("executionMode") or "interactive").strip().lower()
        if execution_mode not in VALID_SKILL_EXECUTION_MODES:
            raise PackageError(f"Unsupported skill execution mode: {execution_mode}")
        payload = {
            "id": slugify(str(raw_payload.get("id") or manifest_path.stem), prefix="skill"),
            "name": str(raw_payload.get("name") or manifest_path.stem).strip() or manifest_path.stem,
            "summary": str(raw_payload.get("summary") or "").strip(),
            "runtime": runtime,
            "executionMode": execution_mode,
            "inputs": _normalize_skill_inputs(raw_payload.get("inputs")),
            "entryFile": entry_file,
            "code": code,
            "createdAt": raw_payload.get("createdAt"),
            "updatedAt": raw_payload.get("updatedAt"),
            "libraryDependencies": _normalize_string_list(raw_payload.get("libraryDependencies")),
        }
        if package_meta:
            payload["packageId"] = package_meta["id"]
            payload["packageName"] = package_meta["name"]
            payload["provenance"] = dict(package_meta["provenance"])
        return payload

    def _normalize_library_payload(self, raw_payload: dict[str, Any], *, manifest_path: Path, package_meta: dict[str, Any] | None = None, enabled: bool | None = None) -> dict[str, Any]:
        if not isinstance(raw_payload, dict):
            raise PackageError("Library manifest must be an object")
        entry_file = _normalize_entry_file(raw_payload.get("entryFile")) if raw_payload.get("entryFile") else ""
        if not entry_file:
            raise PackageError("Library entryFile is required")
        code_path = self._entry_path(manifest_path.parent, entry_file)
        code = code_path.read_text(encoding="utf-8") if code_path.exists() else str(raw_payload.get("code") or "")
        library_id = slugify(str(raw_payload.get("id") or manifest_path.stem), prefix="library")
        exposure_mode = str(raw_payload.get("exposureMode") or "module").strip().lower()
        if exposure_mode not in VALID_LIBRARY_EXPOSURE_MODES:
            raise PackageError(f"Unsupported library exposure mode: {exposure_mode}")
        namespace = str(raw_payload.get("namespace") or "").strip() or None
        if exposure_mode in {"global", "hybrid"} and not namespace:
            namespace = library_id
        if exposure_mode == "module":
            namespace = namespace or None
        module_id = str(raw_payload.get("moduleId") or "").strip()
        package_id = package_meta["id"] if package_meta else "local"
        if not module_id:
            module_id = f"{package_id}/{library_id}"
        payload = {
            "id": library_id,
            "name": str(raw_payload.get("name") or library_id).strip() or library_id,
            "summary": str(raw_payload.get("summary") or "").strip(),
            "entryFile": entry_file,
            "code": code,
            "version": str(raw_payload.get("version") or "").strip(),
            "exposureMode": exposure_mode,
            "namespace": namespace,
            "moduleId": module_id,
            "dependencies": _normalize_string_list(raw_payload.get("dependencies")),
            "exports": _normalize_string_list(raw_payload.get("exports")),
            "enabledByDefault": bool(raw_payload.get("enabledByDefault", True)),
            "enabled": bool(raw_payload.get("enabledByDefault", True)) if enabled is None else bool(enabled),
            "apiReference": _normalize_api_reference(raw_payload.get("apiReference")),
            "author": str(raw_payload.get("author") or "").strip(),
            "homepage": str(raw_payload.get("homepage") or "").strip(),
            "minDarkForgeVersion": str(raw_payload.get("minDarkForgeVersion") or "").strip(),
        }
        if package_meta:
            payload["packageId"] = package_meta["id"]
            payload["packageName"] = package_meta["name"]
            payload["provenance"] = dict(package_meta["provenance"])
        return payload

    def _iter_skill_records(self) -> list[SkillRecord]:
        records: dict[str, SkillRecord] = {}
        for manifest_path in sorted(self.builtin_skills_dir.glob("*.json")):
            try:
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                record = self._load_skill_manifest(raw, manifest_path=manifest_path, source_type="builtin")
                records[record.id] = record
            except Exception:
                continue
        for manifest_path in sorted(self.local_skills_dir.glob("*.json")):
            try:
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                record = self._load_skill_manifest(raw, manifest_path=manifest_path, source_type="local")
                records[record.id] = record
            except Exception:
                continue
        for package_dir in sorted(self.packages_dir.glob("*")):
            if not package_dir.is_dir():
                continue
            install_meta = self._read_package_install(package_dir)
            if not install_meta:
                continue
            package_meta = self._package_meta_from_install(install_meta)
            for item in install_meta.get("skills", []):
                try:
                    rel_path = _normalize_rel_path(item.get("manifestPath"))
                    manifest_path = (package_dir / "source" / rel_path).resolve()
                    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                    record = self._load_skill_manifest(raw, manifest_path=manifest_path, source_type="linked", package_meta=package_meta)
                    records[record.id] = record
                except Exception:
                    continue
        return sorted(records.values(), key=lambda record: (record.payload.get("updatedAt") or "", record.payload["name"]), reverse=True)

    def _iter_library_records(self) -> list[LibraryRecord]:
        records: dict[str, LibraryRecord] = {}
        for manifest_path in sorted(self.builtin_libraries_dir.glob("*.json")):
            try:
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                record = self._load_library_manifest(raw, manifest_path=manifest_path, source_type="builtin")
                records[record.payload["moduleId"]] = record
            except Exception:
                continue
        for manifest_path in sorted(self.local_libraries_dir.glob("*.json")):
            try:
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                record = self._load_library_manifest(raw, manifest_path=manifest_path, source_type="local")
                records[record.payload["moduleId"]] = record
            except Exception:
                continue
        for package_dir in sorted(self.packages_dir.glob("*")):
            if not package_dir.is_dir():
                continue
            install_meta = self._read_package_install(package_dir)
            if not install_meta:
                continue
            package_meta = self._package_meta_from_install(install_meta)
            enabled_state = install_meta.get("libraryState", {})
            for item in install_meta.get("libraries", []):
                try:
                    rel_path = _normalize_rel_path(item.get("manifestPath"))
                    manifest_path = (package_dir / "source" / rel_path).resolve()
                    raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                    raw_module_id = str(raw.get("moduleId") or "").strip()
                    fallback_id = slugify(str(raw.get("id") or manifest_path.stem), prefix="library")
                    module_id = raw_module_id or f"{package_meta['id']}/{fallback_id}"
                    enabled = enabled_state.get(module_id)
                    record = self._load_library_manifest(raw, manifest_path=manifest_path, source_type="linked", package_meta=package_meta, enabled=enabled)
                    records[record.payload["moduleId"]] = record
                except Exception:
                    continue
        return sorted(records.values(), key=lambda record: (record.payload["name"], record.payload["moduleId"]))

    def list_skills(self) -> list[dict[str, Any]]:
        return [record.to_summary() for record in self._iter_skill_records()]

    def load_skill(self, skill_id: str) -> dict[str, Any]:
        normalized = slugify(skill_id, prefix="skill")
        for record in self._iter_skill_records():
            if record.id == normalized:
                return record.to_detail()
        raise FileNotFoundError(skill_id)

    def save_skill(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.ensure_storage()
        skill_id = slugify(str(payload.get("id") or payload.get("name") or ""), prefix="skill")
        previous_id = str(payload.get("previousId") or "").strip()
        manifest_path = self._skill_file(skill_id)
        entry_file = _normalize_entry_file(payload.get("entryFile") or f"{skill_id}.js")
        entry_path = self._entry_path(self.local_skills_dir, entry_file)
        raw_manifest = {
            "id": skill_id,
            "name": str(payload.get("name") or skill_id).strip() or skill_id,
            "summary": str(payload.get("summary") or "").strip(),
            "runtime": str(payload.get("runtime") or DEFAULT_SKILL_RUNTIME).strip().lower(),
            "executionMode": str(payload.get("executionMode") or "interactive").strip().lower(),
            "inputs": _normalize_skill_inputs(payload.get("inputs")),
            "entryFile": entry_file,
            "libraryDependencies": _normalize_string_list(payload.get("libraryDependencies")),
            "createdAt": utc_now_iso(),
            "updatedAt": utc_now_iso(),
        }
        if manifest_path.exists():
            try:
                existing = json.loads(manifest_path.read_text(encoding="utf-8"))
                raw_manifest["createdAt"] = existing.get("createdAt", raw_manifest["createdAt"])
            except Exception:
                pass
        record = self._load_skill_manifest(raw_manifest | {"code": str(payload.get("code") or "")}, manifest_path=manifest_path, source_type="local")
        entry_path.parent.mkdir(parents=True, exist_ok=True)
        entry_path.write_text(record.code, encoding="utf-8")
        manifest_path.write_text(json.dumps({key: value for key, value in raw_manifest.items() if key != "code"}, indent=2) + "\n", encoding="utf-8")
        if previous_id:
            previous_path = self._skill_file(previous_id)
            if previous_path.exists() and previous_path != manifest_path:
                previous_path.unlink()
        return record.to_detail()

    def delete_skill(self, skill_id: str) -> None:
        target = self._skill_file(skill_id)
        if not target.exists():
            for record in self._iter_skill_records():
                if record.id == slugify(skill_id, prefix="skill"):
                    raise PackageError("Built-in and linked skills are managed by their source packages")
            raise FileNotFoundError(skill_id)
        raw = json.loads(target.read_text(encoding="utf-8"))
        entry_file = raw.get("entryFile")
        if entry_file:
            try:
                entry_path = self._entry_path(self.local_skills_dir, entry_file)
                if entry_path.exists():
                    entry_path.unlink()
            except Exception:
                pass
        target.unlink()

    def list_libraries(self) -> list[dict[str, Any]]:
        return [record.to_summary() for record in self._iter_library_records()]

    def list_packages(self) -> list[dict[str, Any]]:
        packages: list[dict[str, Any]] = []
        for package_dir in sorted(self.packages_dir.glob("*")):
            install_meta = self._read_package_install(package_dir)
            if not install_meta:
                continue
            packages.append({
                "id": install_meta["package"]["id"],
                "name": install_meta["package"]["name"],
                "summary": install_meta["package"].get("summary", ""),
                "author": install_meta["package"].get("author", ""),
                "homepage": install_meta["package"].get("homepage", ""),
                "sourceType": "linked",
                "repoUrl": install_meta["source"]["repoUrl"],
                "sourceRef": install_meta["source"]["ref"],
                "resolvedCommit": install_meta["source"]["resolvedCommit"],
                "subpath": install_meta["source"].get("subpath", ""),
                "installedAt": install_meta.get("installedAt"),
                "updatedAt": install_meta.get("updatedAt"),
                "skillCount": len(install_meta.get("skills", [])),
                "libraryCount": len(install_meta.get("libraries", [])),
                "hasUpdate": False,
            })
        return packages

    def get_runtime_catalog(self) -> dict[str, Any]:
        libraries = self.list_libraries()
        api_entries: list[dict[str, Any]] = []
        for library in libraries:
            if not library.get("enabled", False):
                continue
            for entry in library.get("apiReference", []):
                enriched = dict(entry)
                enriched["sourceType"] = library["sourceType"]
                enriched["libraryId"] = library["id"]
                enriched["moduleId"] = library["moduleId"]
                enriched["libraryName"] = library["name"]
                api_entries.append(enriched)
        return {
            "libraries": libraries,
            "apiCatalog": api_entries,
        }

    def set_library_enabled(self, module_id: str, enabled: bool) -> dict[str, Any]:
        target_module_id = str(module_id or "").strip()
        if not target_module_id:
            raise PackageError("moduleId is required")
        for package_dir in sorted(self.packages_dir.glob("*")):
            install_meta = self._read_package_install(package_dir)
            if not install_meta:
                continue
            library_state = dict(install_meta.get("libraryState", {}))
            library_ids = []
            for item in install_meta.get("libraries", []):
                raw_manifest = json.loads((package_dir / "source" / _normalize_rel_path(item.get("manifestPath"))).read_text(encoding="utf-8"))
                library_id = str(raw_manifest.get("moduleId") or "").strip()
                if not library_id:
                    fallback_id = slugify(str(raw_manifest.get("id") or Path(item.get("manifestPath")).stem), prefix="library")
                    library_id = f"{install_meta['package']['id']}/{fallback_id}"
                library_ids.append(library_id)
            if target_module_id not in library_ids:
                continue
            library_state[target_module_id] = bool(enabled)
            install_meta["libraryState"] = library_state
            install_meta["updatedAt"] = utc_now_iso()
            self._write_package_install(package_dir, install_meta)
            for record in self._iter_library_records():
                if record.payload["moduleId"] == target_module_id:
                    return record.to_summary()
            break
        raise FileNotFoundError(module_id)

    def preview_package(self, source: str) -> dict[str, Any]:
        fetcher = GithubPackageFetcher(source)
        index = fetcher.fetch_json_file(PACKAGE_INDEX_NAME)
        package_payload = self._normalize_package_index(index)
        package_id = package_payload["id"]
        package_name = package_payload["name"]
        provenance = {
            "repoUrl": fetcher.repo_url,
            "sourceRef": fetcher.ref,
            "resolvedCommit": fetcher.resolve_commit(),
            "subpath": fetcher.subpath,
        }
        package_meta = {
            "id": package_id,
            "name": package_name,
            "provenance": provenance,
        }
        preview_skills: list[dict[str, Any]] = []
        preview_libraries: list[dict[str, Any]] = []
        files_to_write: dict[str, str] = {PACKAGE_INDEX_NAME: json.dumps(index, indent=2) + "\n"}
        for entry in package_payload["skills"]:
            manifest_rel = entry["manifestPath"]
            raw_manifest = fetcher.fetch_json_file(manifest_rel)
            manifest_virtual_path = Path("/__preview__") / manifest_rel
            manifest_dir = manifest_virtual_path.parent
            skill_payload = self._normalize_remote_skill_payload(raw_manifest, manifest_rel=manifest_rel, package_meta=package_meta, fetcher=fetcher)
            preview_skills.append({
                "id": skill_payload["id"],
                "name": skill_payload["name"],
                "summary": skill_payload["summary"],
                "runtime": skill_payload["runtime"],
                "executionMode": skill_payload["executionMode"],
                "entryFile": skill_payload["entryFile"],
                "libraryDependencies": list(skill_payload["libraryDependencies"]),
            })
            files_to_write[manifest_rel] = json.dumps({key: value for key, value in raw_manifest.items() if key != "code"}, indent=2) + "\n"
            if skill_payload["entryFile"]:
                entry_rel = _normalize_rel_path(posixpath.join(posixpath.dirname(manifest_rel), skill_payload["entryFile"]))
                files_to_write[entry_rel] = fetcher.fetch_text(entry_rel)
        for entry in package_payload["libraries"]:
            manifest_rel = entry["manifestPath"]
            raw_manifest = fetcher.fetch_json_file(manifest_rel)
            library_payload = self._normalize_remote_library_payload(raw_manifest, manifest_rel=manifest_rel, package_meta=package_meta, fetcher=fetcher)
            preview_libraries.append({
                "id": library_payload["id"],
                "name": library_payload["name"],
                "summary": library_payload["summary"],
                "version": library_payload["version"],
                "exposureMode": library_payload["exposureMode"],
                "namespace": library_payload["namespace"],
                "moduleId": library_payload["moduleId"],
                "enabledByDefault": library_payload["enabledByDefault"],
                "dependencies": list(library_payload["dependencies"]),
                "apiReference": list(library_payload["apiReference"]),
            })
            files_to_write[manifest_rel] = json.dumps({key: value for key, value in raw_manifest.items() if key != "code"}, indent=2) + "\n"
            entry_rel = _normalize_rel_path(posixpath.join(posixpath.dirname(manifest_rel), library_payload["entryFile"]))
            files_to_write[entry_rel] = fetcher.fetch_text(entry_rel)
        return {
            "package": package_payload,
            "source": {
                "repoUrl": fetcher.repo_url,
                "ref": fetcher.ref,
                "resolvedCommit": fetcher.resolve_commit(),
                "subpath": fetcher.subpath,
            },
            "skills": preview_skills,
            "libraries": preview_libraries,
            "files": files_to_write,
        }

    def install_package(self, source: str) -> dict[str, Any]:
        preview = self.preview_package(source)
        package_id = preview["package"]["id"]
        package_dir = (self.packages_dir / package_id).resolve()
        existing_install = self._read_package_install(package_dir)
        preserved_library_state = dict((existing_install or {}).get("libraryState", {}))
        preserved_installed_at = (existing_install or {}).get("installedAt")
        if package_dir.exists():
            shutil.rmtree(package_dir)
        source_dir = package_dir / "source"
        source_dir.mkdir(parents=True, exist_ok=True)
        for rel_path, text in preview["files"].items():
            target = (source_dir / _normalize_rel_path(rel_path)).resolve()
            if not target.is_relative_to(source_dir):
                raise PackageError("Package file escaped installation root")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8")
        install_meta = {
            "package": preview["package"],
            "source": {
                "repoUrl": preview["source"]["repoUrl"],
                "ref": preview["source"]["ref"],
                "resolvedCommit": preview["source"]["resolvedCommit"],
                "subpath": preview["source"]["subpath"],
            },
            "skills": preview["package"]["skills"],
            "libraries": preview["package"]["libraries"],
            "libraryState": {
                library["moduleId"]: bool(preserved_library_state.get(library["moduleId"], library.get("enabledByDefault", True)))
                for library in preview["libraries"]
            },
            "installedAt": preserved_installed_at or utc_now_iso(),
            "updatedAt": utc_now_iso(),
        }
        self._write_package_install(package_dir, install_meta)
        return {
            "ok": True,
            "package": preview["package"],
            "source": install_meta["source"],
            "skills": preview["skills"],
            "libraries": preview["libraries"],
        }

    def check_package_update(self, package_id: str) -> dict[str, Any]:
        package_dir = (self.packages_dir / slugify(package_id, prefix="package")).resolve()
        install_meta = self._read_package_install(package_dir)
        if not install_meta:
            raise FileNotFoundError(package_id)
        fetcher = GithubPackageFetcher(self._rebuild_source_url(install_meta["source"]))
        latest_commit = fetcher.resolve_commit()
        current_commit = str(install_meta["source"].get("resolvedCommit") or "")
        return {
            "packageId": install_meta["package"]["id"],
            "repoUrl": install_meta["source"]["repoUrl"],
            "sourceRef": install_meta["source"]["ref"],
            "currentCommit": current_commit,
            "latestCommit": latest_commit,
            "hasUpdate": bool(current_commit and latest_commit and current_commit != latest_commit),
        }

    def update_package(self, package_id: str) -> dict[str, Any]:
        package_dir = (self.packages_dir / slugify(package_id, prefix="package")).resolve()
        install_meta = self._read_package_install(package_dir)
        if not install_meta:
            raise FileNotFoundError(package_id)
        result = self.install_package(self._rebuild_source_url(install_meta["source"]))
        result["ok"] = True
        return result

    def delete_package(self, package_id: str) -> None:
        package_dir = (self.packages_dir / slugify(package_id, prefix="package")).resolve()
        if not package_dir.exists():
            raise FileNotFoundError(package_id)
        shutil.rmtree(package_dir)

    def preprocess_code(self, code: str, *, library_dependencies: list[str] | None = None, skill_input: dict[str, Any] | None = None) -> str:
        libraries = self._iter_library_records()
        enabled_libraries = [record for record in libraries if record.payload.get("enabled", False)]
        dependency_set = set(library_dependencies or [])
        ordered: list[LibraryRecord] = []
        seen: set[str] = set()

        def visit(record: LibraryRecord) -> None:
            module_id = record.payload["moduleId"]
            if module_id in seen:
                return
            seen.add(module_id)
            for dependency in record.payload.get("dependencies", []):
                dependency_record = self._resolve_library_dependency(dependency, enabled_libraries)
                visit(dependency_record)
            ordered.append(record)

        for record in enabled_libraries:
            visit(record)

        config_entries = []
        for record in ordered:
            payload = record.payload
            aliases = [payload["id"]]
            if payload.get("namespace"):
                aliases.append(payload["namespace"])
            aliases.append(payload["moduleId"].split("/")[-1])
            unique_aliases: list[str] = []
            for alias in aliases:
                alias_text = str(alias or "").strip()
                if alias_text and alias_text not in unique_aliases:
                    unique_aliases.append(alias_text)
            config_entries.append({
                "id": payload["moduleId"],
                "aliases": unique_aliases,
                "enabled": bool(payload.get("enabled", False)),
                "namespace": payload.get("namespace"),
                "exposureMode": payload.get("exposureMode"),
                "versionHash": hashlib.sha1(record.code.encode("utf-8")).hexdigest(),
            })

        library_definitions = []
        for record in ordered:
            payload = record.payload
            meta = {
                "id": payload["moduleId"],
                "aliases": [payload["id"], payload.get("namespace"), payload["moduleId"].split("/")[-1]],
                "namespace": payload.get("namespace"),
                "exposureMode": payload["exposureMode"],
                "versionHash": hashlib.sha1(record.code.encode("utf-8")).hexdigest(),
            }
            library_definitions.append(
                "globalThis.__darkforgeRuntime.define("
                + json.dumps(meta, ensure_ascii=False)
                + ", function(module, exports, require, globalThis) {\n"
                + "  return (function(module, exports, require, globalThis) {\n"
                + record.code
                + "\n  }).call(globalThis, module, exports, require, globalThis);\n"
                + "});"
            )

        prelude_parts = [
            "(function(){",
            "if (!globalThis.__darkforgeRuntime) {",
            "  const factories = Object.create(null);",
            "  const metaById = Object.create(null);",
            "  const cache = Object.create(null);",
            "  let aliasMap = Object.create(null);",
            "  let aliasConflicts = Object.create(null);",
            "  let enabledMap = Object.create(null);",
            "  const namespaces = Object.create(null);",
            "  if (!globalThis.Libraries || typeof globalThis.Libraries !== 'object') { globalThis.Libraries = Object.create(null); }",
            "  const assignGlobal = (id, meta, value) => {",
            "    if (!meta || !meta.namespace || (meta.exposureMode !== 'global' && meta.exposureMode !== 'hybrid')) return;",
            "    globalThis.Libraries[meta.namespace] = value;",
            "    namespaces[id] = meta.namespace;",
            "  };",
            "  const removeDisabledGlobals = () => {",
            "    for (const id of Object.keys(namespaces)) {",
            "      if (!enabledMap[id]) {",
            "        const namespace = namespaces[id];",
            "        if (namespace && Object.prototype.hasOwnProperty.call(globalThis.Libraries, namespace)) { delete globalThis.Libraries[namespace]; }",
            "        delete namespaces[id];",
            "        delete cache[id];",
            "      }",
            "    }",
            "  };",
            "  const resolve = (request) => {",
            "    const wanted = String(request || '').trim();",
            "    if (!wanted) throw new Error('require() expects a library id');",
            "    if (enabledMap[wanted] && factories[wanted]) return wanted;",
            "    if (Object.prototype.hasOwnProperty.call(aliasConflicts, wanted)) {",
            "      throw new Error('Ambiguous library alias \"' + wanted + '\". Use one of: ' + aliasConflicts[wanted].join(', '));",
            "    }",
            "    const resolved = aliasMap[wanted];",
            "    if (resolved && enabledMap[resolved] && factories[resolved]) return resolved;",
            "    if (resolved && enabledMap[resolved] && !factories[resolved]) {",
            "      throw new Error('Library factory not registered for ' + resolved);",
            "    }",
            "    throw new Error('Cannot require library \"' + wanted + '\"');",
            "  };",
            "  const requireFn = (request) => {",
            "    const id = resolve(request);",
            "    if (cache[id]) return cache[id].exports;",
            "    const factory = factories[id];",
            "    if (typeof factory !== 'function') throw new Error('Library not registered: ' + id);",
            "    const module = { id, exports: {} };",
            "    cache[id] = module;",
            "    const returned = factory(module, module.exports, requireFn, globalThis);",
            "    if (returned !== undefined) module.exports = returned;",
            "    assignGlobal(id, metaById[id], module.exports);",
            "    return module.exports;",
            "  };",
            "  globalThis.__darkforgeRuntime = {",
            "    configure(entries) {",
            "      enabledMap = Object.create(null);",
            "      aliasMap = Object.create(null);",
            "      aliasConflicts = Object.create(null);",
            "      for (const entry of entries || []) {",
            "        if (!entry || !entry.id) continue;",
            "        enabledMap[entry.id] = !!entry.enabled;",
            "        const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];",
            "        for (const rawAlias of aliases) {",
            "          const alias = String(rawAlias || '').trim();",
            "          if (!alias) continue;",
            "          if (aliasMap[alias] && aliasMap[alias] !== entry.id) {",
            "            aliasConflicts[alias] = [aliasMap[alias], entry.id].filter((value, index, array) => array.indexOf(value) === index);",
            "            delete aliasMap[alias];",
            "          } else if (!aliasConflicts[alias]) {",
            "            aliasMap[alias] = entry.id;",
            "          }",
            "        }",
            "      }",
            "      removeDisabledGlobals();",
            "    },",
            "    define(meta, factory) {",
            "      const id = String(meta && meta.id || '').trim();",
            "      if (!id) throw new Error('Library definition missing id');",
            "      const previous = metaById[id];",
            "      metaById[id] = Object.assign({}, meta || {});",
            "      factories[id] = factory;",
            "      if (previous && previous.versionHash && metaById[id].versionHash && previous.versionHash !== metaById[id].versionHash) { delete cache[id]; }",
            "      if (enabledMap[id] && (metaById[id].exposureMode === 'global' || metaById[id].exposureMode === 'hybrid')) {",
            "        assignGlobal(id, metaById[id], requireFn(id));",
            "      }",
            "    },",
            "    require: requireFn,",
            "    metadata: metaById,",
            "  };",
            "  globalThis.require = requireFn;",
            "}",
            "globalThis.__darkforgeRuntime.configure(" + json.dumps(config_entries, ensure_ascii=False) + ");",
            *library_definitions,
            "})();",
        ]
        return "\n".join(prelude_parts) + "\n" + code

    def _resolve_library_dependency(self, dependency: str, libraries: list[LibraryRecord]) -> LibraryRecord:
        wanted = str(dependency or "").strip()
        for record in libraries:
            payload = record.payload
            aliases = {
                payload["moduleId"],
                payload["id"],
                payload["moduleId"].split("/")[-1],
            }
            if payload.get("namespace"):
                aliases.add(str(payload["namespace"]))
            if wanted in aliases:
                return record
        raise PackageError(f"Unknown library dependency: {wanted}")

    def _normalize_package_index(self, raw_payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(raw_payload, dict):
            raise PackageError("Package index must be a JSON object")
        package_info = raw_payload.get("package")
        if not isinstance(package_info, dict):
            raise PackageError("Package index must include a package object")
        package_id = slugify(str(package_info.get("id") or package_info.get("name") or "package"), prefix="package")
        package_payload = {
            "schemaVersion": int(raw_payload.get("schemaVersion") or 1),
            "id": package_id,
            "name": str(package_info.get("name") or package_id).strip() or package_id,
            "summary": str(package_info.get("summary") or "").strip(),
            "author": str(package_info.get("author") or "").strip(),
            "homepage": str(package_info.get("homepage") or "").strip(),
            "skills": [],
            "libraries": [],
        }
        for key in ("skills", "libraries"):
            entries = raw_payload.get(key) or []
            if not isinstance(entries, list):
                raise PackageError(f"Package index {key} must be an array")
            normalized_entries = []
            seen_ids: set[str] = set()
            for raw_entry in entries:
                if not isinstance(raw_entry, dict):
                    raise PackageError(f"Package index {key} entries must be objects")
                entry_id = slugify(str(raw_entry.get("id") or Path(str(raw_entry.get("manifestPath") or "")).stem), prefix=key[:-1] or "item")
                if entry_id in seen_ids:
                    raise PackageError(f"Duplicate {key[:-1]} id in package index: {entry_id}")
                seen_ids.add(entry_id)
                normalized_entries.append({
                    "id": entry_id,
                    "manifestPath": _normalize_rel_path(raw_entry.get("manifestPath")),
                })
            package_payload[key] = normalized_entries
        return package_payload

    def _normalize_remote_skill_payload(self, raw_manifest: dict[str, Any], *, manifest_rel: str, package_meta: dict[str, Any], fetcher: GithubPackageFetcher) -> dict[str, Any]:
        if not isinstance(raw_manifest, dict):
            raise PackageError(f"Skill manifest must be an object: {manifest_rel}")
        entry_file = _normalize_entry_file(raw_manifest.get("entryFile")) if raw_manifest.get("entryFile") else ""
        code = str(raw_manifest.get("code") or "")
        if entry_file:
            entry_rel = _normalize_rel_path(posixpath.join(posixpath.dirname(manifest_rel), entry_file))
            code = fetcher.fetch_text(entry_rel)
        runtime = str(raw_manifest.get("runtime") or DEFAULT_SKILL_RUNTIME).strip().lower()
        if runtime not in VALID_SKILL_RUNTIMES:
            raise PackageError(f"Unsupported skill runtime: {runtime}")
        execution_mode = str(raw_manifest.get("executionMode") or "interactive").strip().lower()
        if execution_mode not in VALID_SKILL_EXECUTION_MODES:
            raise PackageError(f"Unsupported skill execution mode: {execution_mode}")
        return {
            "id": slugify(str(raw_manifest.get("id") or Path(manifest_rel).stem), prefix="skill"),
            "name": str(raw_manifest.get("name") or Path(manifest_rel).stem).strip(),
            "summary": str(raw_manifest.get("summary") or "").strip(),
            "runtime": runtime,
            "executionMode": execution_mode,
            "entryFile": entry_file,
            "code": code,
            "libraryDependencies": _normalize_string_list(raw_manifest.get("libraryDependencies")),
            "inputs": _normalize_skill_inputs(raw_manifest.get("inputs")),
            "packageId": package_meta["id"],
            "packageName": package_meta["name"],
            "provenance": dict(package_meta["provenance"]),
        }

    def _normalize_remote_library_payload(self, raw_manifest: dict[str, Any], *, manifest_rel: str, package_meta: dict[str, Any], fetcher: GithubPackageFetcher) -> dict[str, Any]:
        if not isinstance(raw_manifest, dict):
            raise PackageError(f"Library manifest must be an object: {manifest_rel}")
        entry_file = _normalize_entry_file(raw_manifest.get("entryFile"))
        entry_rel = _normalize_rel_path(posixpath.join(posixpath.dirname(manifest_rel), entry_file))
        code = fetcher.fetch_text(entry_rel)
        library_id = slugify(str(raw_manifest.get("id") or Path(manifest_rel).stem), prefix="library")
        exposure_mode = str(raw_manifest.get("exposureMode") or "module").strip().lower()
        if exposure_mode not in VALID_LIBRARY_EXPOSURE_MODES:
            raise PackageError(f"Unsupported library exposure mode: {exposure_mode}")
        namespace = str(raw_manifest.get("namespace") or "").strip() or None
        if exposure_mode in {"global", "hybrid"} and not namespace:
            namespace = library_id
        module_id = str(raw_manifest.get("moduleId") or "").strip() or f"{package_meta['id']}/{library_id}"
        return {
            "id": library_id,
            "name": str(raw_manifest.get("name") or library_id).strip() or library_id,
            "summary": str(raw_manifest.get("summary") or "").strip(),
            "version": str(raw_manifest.get("version") or "").strip(),
            "entryFile": entry_file,
            "code": code,
            "exposureMode": exposure_mode,
            "namespace": namespace,
            "moduleId": module_id,
            "dependencies": _normalize_string_list(raw_manifest.get("dependencies")),
            "enabledByDefault": bool(raw_manifest.get("enabledByDefault", True)),
            "apiReference": _normalize_api_reference(raw_manifest.get("apiReference")),
        }

    def _package_meta_from_install(self, install_meta: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": install_meta["package"]["id"],
            "name": install_meta["package"]["name"],
            "provenance": {
                "repoUrl": install_meta["source"]["repoUrl"],
                "sourceRef": install_meta["source"]["ref"],
                "resolvedCommit": install_meta["source"]["resolvedCommit"],
                "subpath": install_meta["source"].get("subpath", ""),
            },
        }

    def _read_package_install(self, package_dir: Path) -> dict[str, Any] | None:
        target = package_dir / "package-install.json"
        if not target.exists():
            return None
        try:
            return json.loads(target.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _write_package_install(self, package_dir: Path, payload: dict[str, Any]) -> None:
        package_dir.mkdir(parents=True, exist_ok=True)
        (package_dir / "package-install.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    @staticmethod
    def _rebuild_source_url(source: dict[str, Any]) -> str:
        repo_url = str(source.get("repoUrl") or "").rstrip("/")
        ref = str(source.get("ref") or "HEAD").strip() or "HEAD"
        subpath = _normalize_rel_path(source.get("subpath"), allow_empty=True)
        if subpath:
            return f"{repo_url}/tree/{ref}/{subpath}"
        if ref and ref != "HEAD":
            return f"{repo_url}/tree/{ref}"
        return repo_url
