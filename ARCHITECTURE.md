# LLuminous Quill — Architecture

## 1. Runtime flow

1. The UI creates a run with a selected model, workspace, and policy profile.
2. The context builder assembles the conversation, model-specific system prompt, tool-control guide, compact skill catalog, and relevant project instructions.
3. The provider adapter sends the request to the selected model.
4. The model response is parsed into either a final answer or a typed tool request.
5. The tool dispatcher passes every request through the policy engine.
6. If the policy requires consent, the run pauses and emits an approval-request event. Approval executes the validated request; rejection returns a structured denial to the model.
7. The tool result is appended to that agent's own context and the loop continues until completion, cancellation, or a configured limit.
8. Events and usage estimates are persisted for the UI and resumable sessions.

Never treat free-form model text as an executable tool call. Tool calls must match a registered schema.

## 2. Core interfaces

### ModelProvider

Responsibilities:
- send messages and tool definitions;
- expose streaming text/tool-call events when supported;
- return usage metadata when the provider makes it available;
- identify provider errors, rate limits, cancellation and unsupported capabilities.

Keep provider-specific message formats inside adapters. Internally, use a canonical message/event representation.

### Tool

Each tool declares:
- stable name and version;
- input schema;
- required capabilities;
- risk category;
- execution handler.

A tool handler must not bypass the policy engine. Avoid one generic all-powerful tool when narrower tools suffice.

### WorkspaceRuntime

Provides workspace-scoped operations:
- list and read files;
- write/patch files;
- search within the workspace;
- run a process with a specified working directory and structured arguments;
- report limits and execution metadata.

The runtime owns path canonicalization and containment checks. A security decision must be repeated at execution time to reduce time-of-check/time-of-use bugs. Symlinks, junctions, reparse points, hard links, race conditions and path normalization need platform-specific handling.

### PolicyEngine

Inputs: agent identity, workspace identity, tool, normalized arguments, requested capabilities and current policy.

Possible decisions:
- `allow`
- `deny`
- `require_approval`

The policy engine is deterministic and independent of the LLM. Rejection returns a structured result containing the decision, concise reason and whether retrying with different arguments could help.

### ApprovalBroker

Creates a pending request with a stable ID, human-readable summary and exact normalized action. It pauses the run until approved, rejected, cancelled, or expired. The executor must execute the same validated action that was approved; changed arguments require a new approval.

### AgentCoordinator

Tracks agents independently:
- agent ID and parent ID;
- selected provider/model;
- independent context/history;
- allowed tools and capabilities;
- token/iteration/time budgets;
- cancellation signal;
- status and final summary.

A child agent must not inherit broader privileges than its parent. Cross-container permissions are explicit, narrow and revocable.

## 3. Context and token budget

Use an ordered context assembly strategy:
1. base safety and runtime contract;
2. model-specific system prompt;
3. tool-control guide;
4. recent conversation and relevant summaries;
5. compact skill catalog (name, short description, entry point);
6. only the skill instruction files explicitly opened by the agent;
7. selected file excerpts and recent tool results.

Keep the model's system prompt separate from the tool protocol guide. Different models may use different prompts while sharing the same canonical tool definitions.

Token counting is provider/tokenizer-dependent. Store provider-reported input/output usage when available; show estimates when exact counts are unavailable. Reserve space for tool results and the next response. Summarize older history rather than silently dropping important constraints.

## 4. Skills

A skill directory contains metadata and instructions plus optional companion code. The registry should scan metadata without injecting full skill content into every prompt. The agent can request a skill manifest and then read the full instruction file when relevant.

Companion code is executable code and therefore a security boundary:
- do not execute skill Python automatically just because the skill was discovered;
- show declared capabilities and entry points;
- run it through the same policy/runtime layer, preferably in a restricted process;
- validate input/output schemas;
- treat skill content as untrusted unless explicitly trusted by the user.

Additional language runtimes can be added through adapters later.

## 5. Containers / workspaces

In the first implementation, `containers/One` can be a workspace directory enforced by an allowlisted filesystem runtime. Be precise about the guarantee: path validation prevents ordinary out-of-workspace access, but does not by itself isolate arbitrary processes launched by the agent.

For strong process isolation, use platform-specific enforcement:
- Windows: a restricted process/token and an appropriate OS sandbox or VM/container strategy;
- Linux: namespaces, seccomp, a dedicated user and filesystem/network restrictions where supported.

The application should expose one portable sandbox interface and different OS implementations. If strong isolation is not active, the UI must state that limitation rather than claim the workspace is a fully secure container.

By default:
- no access to files outside the agent's workspace;
- no access to sibling workspaces;
- no unrestricted network or process capability;
- no implicit inheritance of user secrets;
- capabilities are granted explicitly and logged.

## 6. Event model for UI

Emit typed events such as:
- `run.started`
- `agent.started`
- `model.requested`
- `model.token`
- `tool.requested`
- `approval.required`
- `approval.resolved`
- `tool.started`
- `tool.completed`
- `tool.denied`
- `usage.updated`
- `agent.completed`
- `run.failed`
- `run.cancelled`

The UI subscribes to events and renders activity cards. Core logic must not import UI components.

## 7. Persistence and secrets

Persist conversations, run events, policy settings and provider metadata separately. Store API keys in the OS credential store when available, or in a dedicated encrypted local store. The `secrets/` directory is not a security solution by itself and must remain untracked.

## 8. Testable invariants

- An agent cannot read, write or execute against paths outside its allowed roots through registered tools.
- Rejected actions never reach the underlying executor.
- Approval is tied to the exact action and normalized arguments.
- A child agent's capabilities are a subset of its parent's granted capabilities.
- Provider switching does not alter permission policy.
- Unavailable token counts are shown as estimates, not fabricated exact values.
- A missing or broken platform sandbox fails closed for operations that require it.
- Untrusted skill instructions and tool output cannot register tools or silently change permissions.
