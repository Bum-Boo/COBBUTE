from __future__ import annotations

import asyncio
import subprocess
import time

import pytest

from workbot.llm import LLMResult, ResourceManagerClient
from workbot.scheduler import install_scheduler

from test_bot import FakeLLM, make_bot, make_settings, make_update


class SlowLLM(FakeLLM):
    def generate(self, prompt: str) -> LLMResult:
        time.sleep(0.5)
        return super().generate(prompt)


def test_llm_call_does_not_block_the_event_loop(tmp_path):
    bot, telegram, _ = make_bot(tmp_path, SlowLLM(LLMResult("success", "보고서 본문", "ok")))

    async def scenario():
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.02)
                ticks += 1

        task = asyncio.create_task(ticker())
        await bot.handle_update(make_update(100, "/보고서"))
        task.cancel()
        return ticks

    ticks = asyncio.run(scenario())
    assert ticks >= 10, f"event loop stalled during the LLM call (ticks={ticks})"
    assert "보고서 본문" in telegram.messages[-1][1]


def test_auto_report_job_tolerates_a_late_start(tmp_path):
    settings = make_settings(tmp_path)

    class App:
        class state:
            pass

    class Bot:
        async def send_auto_report(self):
            return None

    async def scenario():
        scheduler = install_scheduler(App, Bot(), settings)
        try:
            job = scheduler.get_job("daily_report")
            return job.misfire_grace_time, job.coalesce
        finally:
            scheduler.shutdown(wait=False)

    grace, coalesce = asyncio.run(scenario())
    assert grace is not None and grace >= 600
    assert coalesce is True


@pytest.mark.parametrize("stdout", ["null", "[]", '"text"', "42"])
def test_non_object_json_from_resource_manager_is_an_error(tmp_path, monkeypatch, stdout):
    script = tmp_path / "manager.ps1"
    script.write_text("# fake", encoding="utf-8")
    client = ResourceManagerClient(script, powershell_exe="powershell", timeout_seconds=1)

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, stdout=stdout, stderr="")

    monkeypatch.setattr("workbot.llm.subprocess.run", fake_run)
    assert client.generate("prompt").status == "error"
    ok, _ = client.status_json()
    assert ok is False
