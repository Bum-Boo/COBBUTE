from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, tzinfo

from .db import AttendanceEvent, Database, WorkNote
from .llm import LLMResult, ResourceManagerClient


@dataclass(frozen=True)
class ReportResult:
    content: str
    llm_status: str
    llm_detail: str


def _format_time(value: datetime) -> str:
    return value.strftime("%H:%M")


def _event_label(event_type: str) -> str:
    return "출근" if event_type == "check_in" else "퇴근"


def deterministic_report(target: date, events: list[AttendanceEvent], notes: list[WorkNote]) -> str:
    lines = [f"[{target.isoformat()} 업무보고]", "", "근태"]
    if events:
        for event in events:
            suffix = f" - {event.note}" if event.note else ""
            lines.append(f"- {_event_label(event.event_type)}: {_format_time(event.created_at)}{suffix}")
    else:
        lines.append("- 기록 없음")

    if events and events[-1].event_type == "check_in":
        lines.append("- 확인 필요: 퇴근 기록 없음")

    lines.extend(["", "업무 내용"])
    if notes:
        for idx, note in enumerate(notes, start=1):
            lines.append(f"{idx}. {_format_time(note.created_at)} - {note.note}")
    else:
        lines.append("- 등록된 업무 메모 없음")

    return "\n".join(lines)


def deterministic_summary(target: date, text: str) -> str:
    stripped = text.strip()
    if not stripped:
        return f"[{target.isoformat()} 요약]\n- 요약할 내용이 없습니다."
    lines = [line.strip("- ").strip() for line in stripped.splitlines() if line.strip()]
    if not lines:
        return f"[{target.isoformat()} 요약]\n- 요약할 내용이 없습니다."
    return "\n".join([f"[{target.isoformat()} 요약]"] + [f"- {line}" for line in lines])


def build_report_prompt(target: date, events: list[AttendanceEvent], notes: list[WorkNote]) -> str:
    source = deterministic_report(target, events, notes)
    return "\n".join(
        [
            "너는 한국어 업무 보고서를 간결하게 작성하는 비서다.",
            "아래 원본 기록에 없는 사실은 추가하지 않는다.",
            "사고 과정은 출력하지 말고 최종 보고서만 출력한다.",
            "형식: 제목, 근태, 주요 업무, 확인 필요.",
            "",
            source,
        ]
    )


def build_summary_prompt(target: date, text: str) -> str:
    return "\n".join(
        [
            "너는 한국어 업무 대화를 간결하게 요약하는 비서다.",
            "아래 내용에 없는 사실은 추가하지 않는다.",
            "사고 과정은 출력하지 말고 요약만 출력한다.",
            "",
            f"날짜: {target.isoformat()}",
            "내용:",
            text.strip(),
        ]
    )


class ReportService:
    def __init__(self, db: Database, llm: ResourceManagerClient, tz: tzinfo):
        self.db = db
        self.llm = llm
        self.tz = tz

    def generate_daily_report(self, user_id: int, target: date, created_at: datetime, auto: bool) -> ReportResult:
        events = self.db.list_attendance_for_day(user_id, target, self.tz)
        notes = self.db.list_notes_for_day(user_id, target, self.tz)
        fallback = deterministic_report(target, events, notes)

        llm_result = self.llm.generate(build_report_prompt(target, events, notes))
        if llm_result.status == "success":
            content = llm_result.text
        else:
            content = fallback

        self.db.record_report(
            user_id=user_id,
            report_date=target,
            report_type="daily",
            content=content,
            llm_status=llm_result.status,
            llm_detail=llm_result.detail,
            at=created_at,
            auto=auto,
        )
        return ReportResult(content=content, llm_status=llm_result.status, llm_detail=llm_result.detail)

    def summarize_text(self, target: date, text: str) -> ReportResult:
        fallback = deterministic_summary(target, text)
        llm_result = self.llm.generate(build_summary_prompt(target, text))
        if llm_result.status == "success":
            return ReportResult(llm_result.text, "success", llm_result.detail)
        return ReportResult(fallback, llm_result.status, llm_result.detail)

    def summarize_today_notes(self, user_id: int, target: date) -> ReportResult:
        notes = self.db.list_notes_for_day(user_id, target, self.tz)
        text = "\n".join(note.note for note in notes)
        return self.summarize_text(target, text)
