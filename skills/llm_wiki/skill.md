---
name: llm_wiki
version: 0.1.0
description: Search and maintain a local knowledge wiki about language models, providers, APIs and agent engineering.
entrypoint: wiki_skill.md
capabilities:
  - workspace.read
  - workspace.write
---

# LLM Wiki

Use this skill when the task involves looking up, organizing, or maintaining project knowledge about LLMs, model providers, APIs, or agent architectures.

Read the full workflow in `wiki_skill.md` only when this skill is relevant. Do not execute `skill.py` automatically; ask the runtime to execute any companion code through the normal permission system.
