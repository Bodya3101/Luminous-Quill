from pathlib import Path
import pytest
from lluminous_quill.security.workspace import Workspace, WorkspaceViolation

def test_workspace_reads_and_writes_inside_root(tmp_path: Path) -> None:
    ws=Workspace(tmp_path/"workspace")
    ws.write_file("notes/test.txt","hello")
    assert ws.read_file("notes/test.txt")=="hello"
    assert ws.list_files("notes")[0]["name"]=="test.txt"

def test_workspace_blocks_parent_traversal(tmp_path: Path) -> None:
    ws=Workspace(tmp_path/"workspace")
    with pytest.raises(WorkspaceViolation): ws.read_file("../../outside.txt")

def test_workspace_blocks_absolute_paths(tmp_path: Path) -> None:
    ws=Workspace(tmp_path/"workspace")
    with pytest.raises(WorkspaceViolation): ws.read_file(str(tmp_path/"outside.txt"))
