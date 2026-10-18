from __future__ import annotations
from datetime import datetime, timezone
from threading import Lock
from typing import Any

class EventLog:
    """Thread-safe append-only event stream for observing agent runs."""
    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []
        self._lock = Lock()

    def emit(self, event_type: str, **data: Any) -> dict[str, Any]:
        with self._lock:
            event = {"id": len(self._events) + 1, "type": event_type,
                     "timestamp": datetime.now(timezone.utc).isoformat(), "data": data}
            self._events.append(event)
            return event

    def since(self, event_id: int = 0) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(event) for event in self._events if event["id"] > event_id]
