from __future__ import annotations
import re
from pathlib import Path

class SkillRegistry:
    """Discover compact skill metadata; never run companion Python automatically."""
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def list_skills(self) -> list[dict[str, str]]:
        result = []
        if not self.root.is_dir():
            return result
        for file in sorted(self.root.glob("*/skill.md")):
            text = file.read_text(encoding="utf-8", errors="replace")
            header = text.split("---", 2)[1] if text.startswith("---") and text.count("---") >= 2 else ""
            fields = {}
            for line in header.splitlines():
                match = re.match(r"^([a-zA-Z_-]+):\s*(.*?)\s*$", line)
                if match:
                    fields[match.group(1)] = match.group(2).strip("\"'")
            result.append({"name": fields.get("name", file.parent.name),
                           "description": fields.get("description", ""),
                           "entrypoint": fields.get("entrypoint", "skill.md")})
        return result

    def read_skill(self, name: str) -> dict[str, str]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", name):
            raise PermissionError("Invalid skill name.")
        folder = (self.root / name).resolve()
        try:
            folder.relative_to(self.root)
        except ValueError as exc:
            raise PermissionError("Skill path escaped the registry.") from exc
        manifest = folder / "skill.md"
        if not manifest.is_file():
            raise FileNotFoundError("Skill was not found.")
        metadata = next((item for item in self.list_skills() if item["name"] == name), None)
        entry = metadata["entrypoint"] if metadata else "skill.md"
        target = (folder / entry).resolve()
        try:
            target.relative_to(folder)
        except ValueError as exc:
            raise PermissionError("Skill entry point escaped its directory.") from exc
        if not target.is_file():
            raise FileNotFoundError("Skill instructions were not found.")
        instructions = target.read_text(encoding="utf-8", errors="replace")
        if len(instructions) > 60000:
            instructions = instructions[:60000] + "\n[Truncated at 60,000 characters.]"
        return {"name": name, "manifest": manifest.read_text(encoding="utf-8")[:12000],
                "instructions": instructions, "entrypoint": entry}
