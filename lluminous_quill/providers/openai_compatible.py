from __future__ import annotations
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

@dataclass(slots=True)
class ProviderConfig:
    base_url: str
    model: str
    api_key: str
    temperature: float = 0.2
    max_tokens: int = 4096
    timeout: int = 90

class ProviderError(RuntimeError):
    pass

class OpenAICompatibleProvider:
    """Adapter for providers exposing the OpenAI chat-completions schema."""
    def __init__(self, config: ProviderConfig) -> None:
        self.config = config

    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> dict[str, Any]:
        base = self.config.base_url.rstrip("/")
        endpoint = base if base.endswith("/chat/completions") else base + "/chat/completions"
        payload: dict[str, Any] = {"model": self.config.model, "messages": messages,
                                   "temperature": self.config.temperature, "max_tokens": self.config.max_tokens}
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = "Bearer " + self.config.api_key
        request = urllib.request.Request(endpoint, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                                         headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout) as response:
                raw = response.read(8_000_000)
            decoded = json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read(4000).decode("utf-8", errors="replace")
            raise ProviderError("Provider returned HTTP " + str(exc.code) + ": " + detail) from exc
        except urllib.error.URLError as exc:
            raise ProviderError("Could not reach provider: " + str(exc.reason)) from exc
        except (TimeoutError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProviderError("Provider response could not be processed: " + str(exc)) from exc
        try:
            return {"message": decoded["choices"][0]["message"], "usage": decoded.get("usage", {}),
                    "model": decoded.get("model", self.config.model)}
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError("Provider response has no choices[0].message object.") from exc
