"""A planning period is seven local calendar days from its persisted start."""
from datetime import date, timedelta


def period_start(profile, now):
    weekly = profile.get('weekly_context') or {}
    value = profile.get('active_week_id') or weekly.get('week_id') or weekly.get('week_of')
    return date.fromisoformat(str(value)[:10]) if value else now.date()


def day_offset(profile, weekday, now):
    return (int(weekday) - period_start(profile, now).weekday()) % 7


def current_period(active_start, today):
    start = date.fromisoformat(active_start)
    current = date.fromisoformat(today)
    return active_start if current < start + timedelta(days=7) else today
