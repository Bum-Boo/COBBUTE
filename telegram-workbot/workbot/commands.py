from __future__ import annotations

from dataclasses import dataclass


SUPPORTED_COMMANDS = {
    "start",
    "출근",
    "퇴근",
    "메모",
    "보고서",
    "오늘요약",
    "내근태",
    "상태",
}


@dataclass(frozen=True)
class ParsedCommand:
    name: str
    args: str
    raw: str


def parse_command(text: str) -> ParsedCommand | None:
    stripped = (text or "").strip()
    if not stripped.startswith("/"):
        return None

    token, _, args = stripped.partition(" ")
    command = token[1:]
    command = command.split("@", 1)[0]
    if not command:
        return None
    return ParsedCommand(name=command, args=args.strip(), raw=stripped)


def help_text() -> str:
    return "\n".join(
        [
            "사용 가능한 명령:",
            "/출근 [메모]",
            "/퇴근 [메모]",
            "/메모 내용",
            "/보고서 [오늘|어제|YYYY-MM-DD]",
            "/오늘요약 [텍스트]",
            "/내근태 [YYYY-MM]",
            "/상태",
        ]
    )

