"""Preserve the interruption anchor across unstarted replacement Sessions."""

BASELINE_KEY = 'continuation_active_baseline_minutes'


def continuation_baseline(snapshot):
    return max(int(snapshot.get(BASELINE_KEY) or 0), 0)


def continuation_snapshot(snapshot, active_minutes):
    return {**snapshot, BASELINE_KEY: max(int(active_minutes), 0)}


def remaining_session_minutes(planned, active, snapshot):
    current_work = max(int(active) - continuation_baseline(snapshot), 0)
    return max(int(planned) - current_work, 0)


def interruption_anchor(source):
    if source is None:
        return None
    if source['status'] == 'ready' and source['resumed_from_session_id']:
        return source['resumed_from_session_id']
    return source['id']
