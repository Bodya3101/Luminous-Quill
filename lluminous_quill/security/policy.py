from dataclasses import dataclass
from typing import Literal

Decision = Literal["allow", "deny", "require_approval"]

@dataclass(frozen=True, slots=True)
class PolicyDecision:
    decision: Decision
    reason: str

class PolicyEngine:
    """Deterministic allow/deny rules. The model cannot grant itself capabilities."""
    def decide(self, tool_name: str, ask_before_write: bool = True) -> PolicyDecision:
        if tool_name in {"workspace.list_files", "workspace.read_file", "skills.list", "skills.read"}:
            return PolicyDecision("allow", "Read-only operation in an approved workspace.")
        if tool_name in {"workspace.write_file", "workspace.delete_file"}:
            return PolicyDecision("require_approval" if ask_before_write else "allow",
                                  "File modification requires approval." if ask_before_write else "Allowed by workspace policy.")
        return PolicyDecision("deny", "This tool is not enabled by the current policy.")
