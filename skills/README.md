# Skills

A skill is a directory containing a short manifest/description and detailed instructions. The agent receives only a compact catalog by default, then reads full instructions when needed.

Suggested contract for each skill:
- `skill.md` — discoverable metadata and short description;
- `wiki_skill.md` (optional) — full workflow instructions, or merge these into skill.md later;
- `skill.py` (optional) — companion code, never auto-executed on discovery.

Skill instructions and code are untrusted inputs. Reading a skill must not grant extra permissions; every tool call and code execution still goes through the runtime policy.
