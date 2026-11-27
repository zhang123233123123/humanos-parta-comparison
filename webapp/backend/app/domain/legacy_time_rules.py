"""Compatibility temporal rules; current time is always explicitly supplied."""
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def infer_duration_minutes(text: str) -> int | None:
    chinese_amounts = {
        "半": 0.5,
        "一": 1,
        "一个": 1,
        "两": 2,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
    }
    chinese_match = re.search(r"(半|一个|一|两|二|三|四|五)\s*(小时|分钟)", text)
    if chinese_match:
        amount = chinese_amounts[chinese_match.group(1)]
        return int(amount * 60) if chinese_match.group(2) == "小时" else int(amount)
    match = re.search(
        r"(\d+)\s*(?:个\s*)?(?:-|–|—)?\s*(分钟|minutes?|mins?|min|小时|hours?|hrs?|h)",
        text,
        re.I,
    )
    if not match:
        return None
    amount = int(match.group(1))
    return amount * 60 if match.group(2).lower() in {"小时", "hour", "hours", "hr", "hrs", "h"} else amount


def safe_duration_minutes(value: object, fallback: int = 60, *, infer=infer_duration_minutes) -> int:
    if isinstance(value, (int, float)):
        return max(int(round(float(value))), 5)
    parsed = infer(str(value or ""))
    return max(int(round(float(parsed or fallback))), 5)

def normalize_chinese_clock(value: object) -> str:
    digits = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}

    def clock_number(token: str) -> int:
        if token.startswith("二十"):
            return 20 + (digits.get(token[2], 0) if len(token) > 2 else 0)
        if token.startswith("十"):
            return 10 + (digits.get(token[1], 0) if len(token) > 1 else 0)
        return digits.get(token, 0)

    return re.sub(
        r"(二十[一二三]?|十[一二三四五六七八九]?|[零一二两三四五六七八九])\s*(点|时)",
        lambda match: f"{clock_number(match.group(1))}{match.group(2)}",
        str(value or ""),
    )


def parse_clock_hour(value: str, inherited_period: str = "", *, normalize=normalize_chinese_clock) -> float | None:
    text = re.sub(r"\s+", "", normalize(value))
    period_match = re.search(r"(早上|上午|中午|下午|晚上)", text)
    period = period_match.group(1) if period_match else inherited_period
    colon_match = re.search(r"(\d{1,2})[:：](\d{2})", text)
    if colon_match:
        hour = int(colon_match.group(1))
        minute = int(colon_match.group(2))
    else:
        hour_match = re.search(r"(\d{1,2})(点|时)", text)
        if not hour_match:
            return None
        hour = int(hour_match.group(1))
        minute = 30 if re.search(r"(?:点|时)半", text) else 0
    if period in {"下午", "晚上"} and hour < 12:
        hour += 12
    if period == "中午" and hour < 11:
        hour += 12
    return hour + minute / 60


def format_clock_hour(hour: float) -> str:
    whole_hour = int(hour)
    minute = int(round((hour - whole_hour) * 60))
    if minute == 60:
        whole_hour += 1
        minute = 0
    return f"{whole_hour:02d}:{minute:02d}"


def parse_clock_range(value: str, inherited_period: str = "", *, normalize=normalize_chinese_clock, parse_hour=parse_clock_hour) -> tuple[float, float] | None:
    value = normalize(value)
    clock = r"((?:早上|上午|中午|下午|晚上)?\s*\d{1,2}\s*(?:[:：]\s*\d{2}|点|时))"
    match = re.search(rf"{clock}\s*(?:-|–|—|~|至|到)\s*{clock}", str(value or ""))
    if not match:
        return None
    start_text = match.group(1)
    end_text = match.group(2)
    period_match = re.search(r"(早上|上午|中午|下午|晚上)", start_text)
    inherited = period_match.group(1) if period_match else inherited_period
    start = parse_hour(start_text, inherited)
    end = parse_hour(end_text, inherited)
    if start is None or end is None:
        return None

    explicit_period = re.search(r"(早上|上午|中午|下午|晚上)", f"{start_text}{end_text}")
    if not explicit_period and start < 8 and end <= 8:
        start += 12
        end += 12
    elif end <= start and end < 12:
        end += 12
    return start, end


def safe_timezone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(str(name or "Asia/Shanghai"))
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def today_label(timezone_name: str | None = None, *, clock_now, timezone=safe_timezone) -> str:
    return clock_now(timezone(timezone_name)).strftime("%Y-%m-%d")


def iso_week_id(value: object | None = None, timezone_name: str | None = None, *, clock_now, timezone=safe_timezone) -> str:
    """Return the ISO date of the Monday that owns ``value``.

    A persisted week identifier is deliberately an absolute date rather than a
    locale label such as ``周一``.  This prevents a Thursday block from being
    accidentally reused on the following Thursday.
    """
    if isinstance(value, datetime):
        moment = value
    elif value:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            moment = clock_now(timezone(timezone_name))
    else:
        moment = clock_now(timezone(timezone_name))
    monday = (moment - timedelta(days=moment.weekday())).date()
    return monday.isoformat()


def session_absolute_times(week_id: str, day_index: int, start: float, end: float, timezone_name: str, *, timezone=safe_timezone) -> tuple[str, str]:
    zone = timezone(timezone_name)
    monday = datetime.fromisoformat(week_id).replace(tzinfo=zone)
    start_at = monday + timedelta(days=int(day_index), hours=float(start))
    end_at = monday + timedelta(days=int(day_index), hours=float(end))
    return start_at.isoformat(), end_at.isoformat()
