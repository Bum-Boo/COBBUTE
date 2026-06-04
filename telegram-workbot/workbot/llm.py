from __future__ import annotations

import json
import locale
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class LLMResult:
    status: str
    text: str
    detail: str
    model: str = ""


class ResourceManagerClient:
    def __init__(
        self,
        script_path: Path,
        powershell_exe: str = "powershell",
        timeout_seconds: int = 180,
    ):
        self.script_path = script_path
        self.powershell_exe = powershell_exe
        self.timeout_seconds = timeout_seconds

    def generate(self, prompt: str) -> LLMResult:
        if not self.script_path.exists():
            return LLMResult("error", "", f"Resource manager not found: {self.script_path}")

        command = [
            self.powershell_exe,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(self.script_path),
            "ask",
            prompt,
            "-Json",
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding=locale.getpreferredencoding(False),
                errors="replace",
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return LLMResult("error", "", f"Resource manager timed out after {self.timeout_seconds}s")
        except OSError as exc:
            return LLMResult("error", "", f"Resource manager failed to start: {exc}")

        stdout = completed.stdout.strip()
        stderr = completed.stderr.strip()
        if completed.returncode != 0:
            return LLMResult("error", "", stderr or stdout or f"Exit code {completed.returncode}")

        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            return LLMResult("error", "", "Resource manager returned non-JSON output")

        if payload.get("queued") is True:
            decision = payload.get("decision") or {}
            return LLMResult(
                "queued",
                "",
                str(decision.get("reason") or "Queued by resource manager"),
                str(decision.get("model") or ""),
            )

        decision = payload.get("decision") or {}
        response = payload.get("response") or {}
        text = str(response.get("response") or "").strip()
        if not text:
            return LLMResult("error", "", "Resource manager returned an empty LLM response")
        return LLMResult("success", text, str(decision.get("reason") or ""), str(decision.get("model") or ""))

    def status_json(self) -> tuple[bool, str]:
        if not self.script_path.exists():
            return False, f"Resource manager not found: {self.script_path}"
        command = [
            self.powershell_exe,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(self.script_path),
            "state",
            "-Json",
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding=locale.getpreferredencoding(False),
                errors="replace",
                timeout=20,
                check=False,
            )
        except Exception as exc:
            return False, str(exc)

        if completed.returncode != 0:
            return False, completed.stderr.strip() or completed.stdout.strip()
        try:
            payload = json.loads(completed.stdout)
        except json.JSONDecodeError:
            return False, "Resource manager returned non-JSON status"

        text_route = payload.get("text_route") or {}
        gpu = payload.get("gpu") or {}
        comfy = payload.get("comfy") or {}
        turn = (payload.get("state") or {}).get("turn") or {}
        return True, (
            f"GPU {gpu.get('free_mb', '?')}/{gpu.get('total_mb', '?')} MB free, "
            f"ComfyUI running={comfy.get('running', '?')}, "
            f"turn={turn.get('owner', '?')}/{turn.get('status', '?')}, "
            f"text_route={text_route.get('action', '?')} {text_route.get('model') or ''}"
        ).strip()

