from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path
from typing import Any

from lluminous_quill.core.agent import AgentRunner, RunState
from lluminous_quill.core.skills import SkillRegistry
from lluminous_quill.providers.openai_compatible import OpenAICompatibleProvider, ProviderConfig
from lluminous_quill.security.workspace import Workspace


DEFAULT_PROVIDER = {
    "name": "OpenRouter",
    "base_url": "https://openrouter.ai/api/v1",
    "model": "",
    "system_prompt": "",
    "ask_before_write": True,
}


class AppBridge:
    """WebView API. Provider profiles are local; API keys stay in process memory."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.workspace = Workspace(data_dir / "containers" / "One")
        self.skills = SkillRegistry(data_dir / "skills")
        self.config_path = data_dir / ".config" / "providers" / "providers.json"
        self.legacy_config_path = data_dir / ".config" / "providers" / "default.json"
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.runs: dict[str, RunState] = {}
        self.api_keys: dict[str, str] = {}
        self.providers: list[dict[str, Any]] = []
        self.active_provider_id = ""
        self._load_provider_store()
        env_key = os.environ.get("LLQUILL_API_KEY", "")
        if env_key and self.active_provider_id:
            self.api_keys.setdefault(self.active_provider_id, env_key)

    @staticmethod
    def _normalize_profile(raw: dict[str, Any]) -> dict[str, Any]:
        provider_id = str(raw.get("id") or uuid.uuid4().hex[:12])[:80]
        if not provider_id.replace("-", "").replace("_", "").isalnum():
            provider_id = uuid.uuid4().hex[:12]
        return {
            "id": provider_id,
            "name": str(raw.get("name") or "Новый провайдер").strip()[:80] or "Новый провайдер",
            "base_url": str(raw.get("base_url") or DEFAULT_PROVIDER["base_url"]).strip().rstrip("/"),
            "model": str(raw.get("model") or "").strip(),
            "system_prompt": str(raw.get("system_prompt") or "")[:20000],
            "ask_before_write": bool(raw.get("ask_before_write", True)),
        }

    def _load_provider_store(self) -> None:
        data: Any = None
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass

        if isinstance(data, dict) and isinstance(data.get("providers"), list):
            self.providers = [self._normalize_profile(item) for item in data["providers"] if isinstance(item, dict)]
            requested = str(data.get("active_provider_id") or "")
            ids = {item["id"] for item in self.providers}
            self.active_provider_id = requested if requested in ids else (self.providers[0]["id"] if self.providers else "")
            return

        # Import the single-profile settings used by the first prototype.
        legacy: Any = None
        try:
            legacy = json.loads(self.legacy_config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
        if isinstance(legacy, dict) and legacy.get("base_url"):
            migrated = dict(DEFAULT_PROVIDER)
            migrated.update(legacy)
            migrated["name"] = migrated.get("name") or self._name_from_url(str(migrated["base_url"]))
            profile = self._normalize_profile({"id": "legacy-default", **migrated})
            self.providers = [profile]
            self.active_provider_id = profile["id"]

    @staticmethod
    def _name_from_url(url: str) -> str:
        try:
            host = url.split("//", 1)[-1].split("/", 1)[0]
            return host.removeprefix("www.") or "Провайдер"
        except Exception:
            return "Провайдер"

    def _find_provider(self, provider_id: str) -> dict[str, Any] | None:
        return next((p for p in self.providers if p["id"] == provider_id), None)

    def _persist_provider_store(self) -> None:
        payload = {"version": 1, "active_provider_id": self.active_provider_id, "providers": self.providers}
        tmp_path = self.config_path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self.config_path)

    def _provider_view(self, provider: dict[str, Any]) -> dict[str, Any]:
        view = dict(provider)
        view["has_api_key"] = bool(
            self.api_keys.get(provider["id"]) or
            (os.environ.get("LLQUILL_API_KEY", "") and provider["id"] == self.active_provider_id)
        )
        return view

    def get_bootstrap_data(self) -> dict[str, Any]:
        with self.lock:
            providers = [self._provider_view(p) for p in self.providers]
            active = self._find_provider(self.active_provider_id)
            active_view = self._provider_view(active) if active else {}
        return {
            "app": {"name": "LLuminous Quill", "version": "0.1.0"},
            "providers": providers,
            "active_provider_id": self.active_provider_id,
            "provider": active_view,
            "workspace": {"name": "One", "path": str(self.workspace.root)},
            "skills": self.skills.list_skills(),
            "capabilities": {"filesystem_tools": True, "command_execution": False},
        }

    def save_provider_profile(self, settings: dict[str, Any]) -> dict[str, Any]:
        provider_id = str(settings.get("id") or uuid.uuid4().hex[:12]).strip()
        if not provider_id or len(provider_id) > 80 or not provider_id.replace("-", "").replace("_", "").isalnum():
            return {"ok": False, "error": "Invalid provider profile ID."}
        name = str(settings.get("name") or "").strip()
        base_url = str(settings.get("base_url") or "").strip().rstrip("/")
        model = str(settings.get("model") or "").strip()
        api_key = str(settings.get("api_key") or "").strip()
        if not name:
            return {"ok": False, "error": "Give this provider a name."}
        if not base_url.startswith(("https://", "http://")):
            return {"ok": False, "error": "Base URL must start with http:// or https://."}
        if "@" in base_url.split("//", 1)[-1].split("/", 1)[0]:
            return {"ok": False, "error": "Credentials are not allowed inside the URL."}
        if not model:
            return {"ok": False, "error": "Enter a model identifier."}

        profile = self._normalize_profile({
            "id": provider_id, "name": name, "base_url": base_url, "model": model,
            "system_prompt": settings.get("system_prompt", ""),
            "ask_before_write": settings.get("ask_before_write", True),
        })
        with self.lock:
            index = next((i for i, item in enumerate(self.providers) if item["id"] == provider_id), None)
            if index is None:
                self.providers.append(profile)
            else:
                self.providers[index] = profile
            if api_key:
                self.api_keys[provider_id] = api_key
            elif bool(settings.get("clear_api_key", False)):
                self.api_keys.pop(provider_id, None)
            try:
                self._persist_provider_store()
            except OSError as exc:
                return {"ok": False, "error": "Could not save provider profile: " + str(exc)}
            saved = self._provider_view(profile)
            return {"ok": True, "provider": saved,
                    "providers": [self._provider_view(p) for p in self.providers],
                    "active_provider_id": self.active_provider_id,
                    "message": "Provider saved. Its API key remains in memory only."}

    def set_active_provider(self, provider_id: str) -> dict[str, Any]:
        with self.lock:
            if self._find_provider(str(provider_id)) is None:
                return {"ok": False, "error": "Provider profile not found."}
            previous = self.active_provider_id
            self.active_provider_id = str(provider_id)
            try:
                self._persist_provider_store()
            except OSError as exc:
                self.active_provider_id = previous
                return {"ok": False, "error": "Could not save active provider: " + str(exc)}
            provider = self._find_provider(self.active_provider_id)
            return {"ok": True, "active_provider_id": self.active_provider_id,
                    "provider": self._provider_view(provider) if provider else {}}

    def delete_provider_profile(self, provider_id: str) -> dict[str, Any]:
        with self.lock:
            if self._find_provider(provider_id) is None:
                return {"ok": False, "error": "Provider profile not found."}
            old_providers, old_active = list(self.providers), self.active_provider_id
            self.providers = [p for p in self.providers if p["id"] != provider_id]
            self.api_keys.pop(provider_id, None)
            if self.active_provider_id == provider_id:
                self.active_provider_id = self.providers[0]["id"] if self.providers else ""
            try:
                self._persist_provider_store()
            except OSError as exc:
                self.providers, self.active_provider_id = old_providers, old_active
                return {"ok": False, "error": "Could not delete provider: " + str(exc)}
            return {"ok": True, "providers": [self._provider_view(p) for p in self.providers],
                    "active_provider_id": self.active_provider_id}

    # Kept for compatibility with older frontends.
    def save_provider_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        current = self._find_provider(self.active_provider_id) or {}
        merged = {**current, **settings, "id": current.get("id") or settings.get("id"),
                  "name": settings.get("name") or current.get("name") or self._name_from_url(str(settings.get("base_url", "")))}
        return self.save_provider_profile(merged)

    def start_run(self, user_text: str, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
        user_text = str(user_text).strip()
        if not user_text:
            return {"ok": False, "error": "Message cannot be empty."}
        with self.lock:
            provider_id = self.active_provider_id
            conf = dict(self._find_provider(provider_id) or {})
            key = self.api_keys.get(provider_id) or os.environ.get("LLQUILL_API_KEY", "")
        if not conf.get("model"):
            return {"ok": False, "error": "Add and activate a provider with a model in Settings first."}
        if not key:
            return {"ok": False, "error": "No API key for the active provider. Enter it in Settings or set LLQUILL_API_KEY."}
        run_id = uuid.uuid4().hex[:12]
        run = RunState(run_id)
        with self.lock:
            self.runs[run_id] = run
        provider = OpenAICompatibleProvider(ProviderConfig(str(conf["base_url"]), str(conf["model"]), key))
        runner = AgentRunner(run, self.workspace, self.skills, provider,
                             str(conf.get("system_prompt", "")), bool(conf.get("ask_before_write", True)))
        thread = threading.Thread(target=runner.run_turn, args=(user_text, history or []),
                                  daemon=True, name="quill-" + run_id)
        thread.start()
        return {"ok": True, "run_id": run_id}

    def get_run_state(self, run_id: str, after_event_id: int = 0) -> dict[str, Any]:
        with self.lock:
            run = self.runs.get(str(run_id))
        if run is None:
            return {"ok": False, "error": "Run not found."}
        with run.lock:
            pending = [{"id": item.id, "tool": item.tool, "arguments": item.args, "summary": item.summary}
                       for item in run.pending.values()]
        return {"ok": True, "run_id": run.id, "status": run.status,
                "events": run.events.since(int(after_event_id)), "pending": pending}

    def resolve_approval(self, run_id: str, approval_id: str, approved: bool) -> dict[str, Any]:
        with self.lock:
            run = self.runs.get(str(run_id))
        if run is None:
            return {"ok": False, "error": "Run not found."}
        ok = run.resolve_approval(str(approval_id), bool(approved))
        return {"ok": ok, "error": None if ok else "Approval request no longer exists."}

    def cancel_run(self, run_id: str) -> dict[str, Any]:
        with self.lock:
            run = self.runs.get(str(run_id))
        if run is None:
            return {"ok": False, "error": "Run not found."}
        run.cancel.set()
        with run.lock:
            pending_ids = list(run.pending)
        for approval_id in pending_ids:
            run.resolve_approval(approval_id, False)
        return {"ok": True}
