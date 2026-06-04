from __future__ import annotations

import json
import subprocess
from pathlib import Path

from workbot.llm import ResourceManagerClient


class Completed:
    def __init__(self, stdout: str, stderr: str = "", returncode: int = 0):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


def test_resource_manager_success(monkeypatch, tmp_path: Path) -> None:
    script = tmp_path / "manager.ps1"
    script.write_text("# test", encoding="utf-8")
    payload = {
        "decision": {"reason": "enough VRAM", "model": "qwen3:8b"},
        "response": {"response": "보고서"},
    }

    def fake_run(*args, **kwargs):
        return Completed(json.dumps(payload, ensure_ascii=False))

    monkeypatch.setattr(subprocess, "run", fake_run)
    result = ResourceManagerClient(script).generate("prompt")

    assert result.status == "success"
    assert result.text == "보고서"
    assert result.model == "qwen3:8b"


def test_resource_manager_queued(monkeypatch, tmp_path: Path) -> None:
    script = tmp_path / "manager.ps1"
    script.write_text("# test", encoding="utf-8")
    payload = {"queued": True, "decision": {"reason": "VRAM free is below 3584 MB"}}

    def fake_run(*args, **kwargs):
        return Completed(json.dumps(payload, ensure_ascii=False))

    monkeypatch.setattr(subprocess, "run", fake_run)
    result = ResourceManagerClient(script).generate("prompt")

    assert result.status == "queued"
    assert result.text == ""
    assert "VRAM" in result.detail


def test_resource_manager_error(monkeypatch, tmp_path: Path) -> None:
    script = tmp_path / "manager.ps1"
    script.write_text("# test", encoding="utf-8")

    def fake_run(*args, **kwargs):
        return Completed("", "boom", returncode=1)

    monkeypatch.setattr(subprocess, "run", fake_run)
    result = ResourceManagerClient(script).generate("prompt")

    assert result.status == "error"
    assert result.detail == "boom"

