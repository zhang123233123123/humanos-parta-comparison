"""Existing weekly item time updates from explicit conversation requests."""
import re
from datetime import timedelta
from collections.abc import Callable
from dataclasses import dataclass
from ..domain.task.change_policy import is_explicit_change_request, matching_context_item


@dataclass(frozen=True)
class WeeklyChatContextPorts:
    normalize_chinese_clock: Callable
    parse_clock_hour: Callable
    get_profile: Callable
    ensure_profile: Callable
    parse_clock_range: Callable
    clock_now: Callable
    format_clock_hour: Callable
    upsert_profile: Callable


def update_weekly_context_from_chat(user_id: str, text: str, *, ports: WeeklyChatContextPorts) -> dict | None:
    if not is_explicit_change_request(text):
        return None
    normalized = ports.normalize_chinese_clock(text)
    start = ports.parse_clock_hour(normalized)
    if start is None:
        return None
    profile = ports.get_profile(user_id) or ports.ensure_profile(user_id)
    weekly = dict(profile.get("weekly_context") or {})
    items = [dict(item) for item in weekly.get("context_items", []) if isinstance(item, dict)]
    if not items:
        return None
    matched = matching_context_item(text, items)
    if not matched:
        return None
    raw_type = str(matched.get("type") or matched.get("category") or "")
    item_type = "recurring_routine" if raw_type in {"recurring_routine", "routine", "habit_period"} else "flexible_activity" if raw_type in {"flexible_activity", "ai_arranged"} else "fixed_event"
    if item_type == "flexible_activity":
        return None
    start = round(float(start) * 4) / 4
    clock_range = ports.parse_clock_range(normalized)
    if clock_range:
        start, end = (round(float(clock_range[0]) * 4) / 4, round(float(clock_range[1]) * 4) / 4)
    else:
        previous_duration = float(matched.get("end") or 0) - float(matched.get("start") or 0)
        duration_hours = previous_duration if previous_duration > 0 else max(int(matched.get("duration_minutes") or 60), 15) / 60
        end = start + duration_hours
    day_match = re.search(r"(今天|明天|后天|周[一二三四五六日天]|星期[一二三四五六日天])", text)
    if day_match:
        raw_day = day_match.group(1)
        if raw_day in {"今天", "明天", "后天"}:
            offset = {"今天": 0, "明天": 1, "后天": 2}[raw_day]
            target = ports.clock_now() + timedelta(days=offset)
            day = f"周{'一二三四五六日'[target.weekday()]}"
        else:
            day = raw_day.replace("星期", "周").replace("天", "日")
    else:
        day = str(matched.get("day") or "周一")
    english_day_match = re.search(
        r"\b(today|tomorrow|day\s+after\s+tomorrow|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b",
        text,
        re.IGNORECASE,
    )
    if english_day_match:
        english_day = english_day_match.group(1).lower()
        relative_offsets = {"today": 0, "tomorrow": 1, "day after tomorrow": 2}
        if english_day in relative_offsets:
            target = ports.clock_now() + timedelta(days=relative_offsets[english_day])
            day = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][target.weekday()]
        else:
            day = {
                "mon": "周一", "monday": "周一", "tue": "周二", "tuesday": "周二",
                "wed": "周三", "wednesday": "周三", "thu": "周四", "thursday": "周四",
                "fri": "周五", "friday": "周五", "sat": "周六", "saturday": "周六",
                "sun": "周日", "sunday": "周日",
            }[english_day]
    day_index = {f"周{label}": index for index, label in enumerate("一二三四五六日")}.get(day)
    matched.update({
        "type": item_type,
        "category": item_type,
        "day": day,
        "days": [day_index] if day_index is not None else matched.get("days", []),
        "start": start,
        "end": end,
        "duration_minutes": round((end - start) * 60),
        "confirmed": True,
        "confidence": "high",
        "source": "user_chat_update",
        "updated_at": ports.clock_now().isoformat(),
    })
    def legacy(item: dict) -> str:
        prefix = "日常" if item.get("type") == "recurring_routine" else "可移动" if item.get("type") == "flexible_activity" else "固定"
        range_text = f" {ports.format_clock_hour(float(item['start']))}-{ports.format_clock_hour(float(item['end']))}" if isinstance(item.get("start"), (int, float)) and isinstance(item.get("end"), (int, float)) else ""
        duration = f" 时长{item.get('duration_minutes')}分钟" if item.get("type") == "flexible_activity" and item.get("duration_minutes") else ""
        return f"{prefix} {item.get('day', '')}{range_text} {item.get('title', '')}{duration}".strip()
    weekly["context_items"] = items
    weekly["fixed_events"] = [legacy(item) for item in items]
    # Editing one item's time does not revoke independent weekly constraints.
    saved = ports.upsert_profile({**profile, "weekly_context": weekly})
    return {"item": matched, "weekly_context": saved.get("weekly_context", weekly)}
