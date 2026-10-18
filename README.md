# LLuminous Quill

A portable, security-first workspace for AI agents.

LLuminous Quill is designed around a small platform-independent agent core, pluggable model providers, explicit tool permissions, and isolated workspaces (containers). Windows is the first target; portability to Linux and other platforms is an architectural requirement from day one.

## Principles

- **Deny by default:** agents can only access the workspace and capabilities explicitly granted to them.
- **Enforce outside the model:** prompt instructions are not a security boundary. Every filesystem and process operation is validated by the host runtime.
- **Provider-neutral:** chat, summarization, and subagents can use different models and providers.
- **Context-efficient:** discover skills through short metadata; load full instructions only when needed.
- **Portable core:** OS-specific behavior lives behind interfaces and platform adapters.
- **Observable:** show tool calls, results, denials, and pending approval requests in the UI.
- **User control:** explicit approval can reject a requested action and return that denial to the agent.

## Initial architecture

- `app/` — application entry point and UI integration.
- `core/` — agent loop, run/session state, events, task coordination, context assembly.
- `providers/` — model provider interfaces and provider adapters.
- `tools/` — tool schemas and dispatch.
- `security/` — permission policy, path validation, approval workflow.
- `runtime/` — filesystem/process abstractions and OS adapters.
- `storage/` — settings, conversations, usage and run events.
- `skills/` — discoverable skills and optional companion code.
- `containers/` — isolated workspaces managed by the application.
- `.config/providers/` — provider configuration templates; never store API keys here.
- `secrets/` — local secret storage location; must be excluded from Git.

Exact module names may evolve, but boundaries must remain explicit.

## MVP milestones

1. App shell, settings, event stream and a standard chat view.
2. Provider interface with one working API adapter and streaming support.
3. Minimal agent loop with explicit, typed tool calls.
4. Workspace-scoped filesystem tools and a permission/approval panel.
5. Command execution behind a platform adapter, isolated by default.
6. Skills registry with metadata-first discovery and on-demand instructions.
7. Per-agent context windows, subagent spawning, and a separate summarization provider.
8. Additional providers, robust sandboxing, packaging and Linux verification.

## Security contract

- Each agent receives a workspace identity and capability set.
- No file or command operation is executed before policy validation.
- Paths are canonicalized and checked against allowed roots at execution time.
- Denied or rejected actions return a structured result to the model.
- Cross-container access is denied unless explicitly granted by policy.
- Shell commands are untrusted requests. In approval-required mode, show the actual command, working directory, requested capabilities and relevant environment details.
- API keys, tokens and local secrets must never be committed.
- A UI toggle or system prompt alone does not provide isolation. Use an OS sandbox, restricted process identity, container/VM, or an equivalent enforcement mechanism where appropriate.

## Portability rules

- Keep business logic out of UI modules.
- Put filesystem, process launching, paths, sandboxing and secret storage behind interfaces.
- Use `pathlib` and structured argument lists instead of hard-coded Windows paths or shell string concatenation.
- Keep configuration platform-neutral and use a single app-data resolver for OS-specific storage locations.
- Do not assume PowerShell, `cmd.exe`, Bash, or a particular package manager exists.
- Test path traversal, symlinks, permission denials and subprocess behavior separately on each platform.

## Repository layout

The user-facing data directories (`.config/providers`, `containers`, `projects`, `secrets`, and `skills`) remain separate from application source code. Runtime-generated credentials and state must not be tracked by Git.
