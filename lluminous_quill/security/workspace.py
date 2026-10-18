from __future__ import annotations
from pathlib import Path

class WorkspaceViolation(PermissionError):
    """A filesystem tool attempted to escape its assigned workspace."""

class Workspace:
    """Restricts registered filesystem tools to one workspace; not a process sandbox."""
    def __init__(self, root: Path) -> None:
        self.root = root.expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def resolve(self, relative_path: str = ".") -> Path:
        candidate = Path(relative_path)
        if candidate.is_absolute():
            raise WorkspaceViolation("Use a workspace-relative path, not an absolute path.")
        result = (self.root / candidate).resolve(strict=False)
        try:
            result.relative_to(self.root)
        except ValueError as exc:
            raise WorkspaceViolation("Path is outside the active workspace.") from exc
        return result

    def list_files(self, relative_path: str = ".", limit: int = 200) -> list[dict[str, str]]:
        directory = self.resolve(relative_path)
        if not directory.is_dir():
            raise NotADirectoryError(relative_path)
        found = []
        for item in sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold()))[:max(1, min(limit, 500))]:
            try:
                self.resolve(str(item.relative_to(self.root)))
            except WorkspaceViolation:
                found.append({"name": item.name, "kind": "blocked-link"})
                continue
            found.append({"name": item.name, "kind": "directory" if item.is_dir() else "file"})
        return found

    def read_file(self, relative_path: str, max_bytes: int = 200_000) -> str:
        path = self.resolve(relative_path)
        if not path.is_file():
            raise FileNotFoundError(relative_path)
        data = path.read_bytes()
        if len(data) > max_bytes:
            raise ValueError("File exceeds the 200 KB read limit.")
        return data.decode("utf-8", errors="replace")

    def write_file(self, relative_path: str, content: str) -> dict[str, object]:
        path = self.resolve(relative_path)
        if path == self.root:
            raise WorkspaceViolation("Choose a file inside the workspace.")
        path.parent.mkdir(parents=True, exist_ok=True)
        path = self.resolve(relative_path)
        existed = path.exists()
        path.write_text(content, encoding="utf-8", newline="\n")
        return {"path": str(path.relative_to(self.root)), "overwritten": existed, "bytes": len(content.encode("utf-8"))}

    def delete_file(self, relative_path: str) -> dict[str, object]:
        path = self.resolve(relative_path)
        if not path.is_file():
            raise FileNotFoundError(relative_path)
        path.unlink()
        return {"path": str(path.relative_to(self.root)), "deleted": True}
