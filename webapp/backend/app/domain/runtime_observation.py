"""Self-report normalization; independent of persistence and scheduling."""
import json
from datetime import datetime, timezone

SCORES = ("focus", "energy", "stress")
FIELDS = (*SCORES, "mood", "attention_residue", "emotion", "readiness", "daily_note")


def submitted_values(payload):
    values = {key: payload[key] for key in FIELDS if key in payload and payload[key] is not None and payload[key] != ""}
    for key in SCORES:
        if key not in values:
            continue
        raw = values[key]
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            raise ValueError(f"{key} must be a whole number from 1 to 7")
        try:
            number = float(raw)
            if not number.is_integer() or not 1 <= number <= 7:
                raise ValueError()
        except (TypeError, ValueError, OverflowError):
            raise ValueError(f"{key} must be a whole number from 1 to 7") from None
        values[key] = int(number)
    return values


def project_runtime_state(row, reported=None):
    state = dict(row or {})
    encoded = state.pop("reported_state_json", None)
    try:
        if encoded is not None:
            reported = json.loads(encoded)
        known = isinstance(reported, dict)
        values = submitted_values(reported) if known else {}
    except (ValueError, TypeError, OverflowError):
        # Read-time handling must not turn corrupt legacy data into defaults
        # or block the entire task/schedule view. New writes remain strict.
        known = False
        values = {}
        state['observation_issue'] = 'invalid_recorded_observation'
    if known and reported.get('_reported_at'):
        state['reported_at'] = reported['_reported_at']
    # Legacy compatibility columns contain filler values; never expose them
    # as observations when original submitted fields cannot be established.
    for key in FIELDS:
        state[key] = values.get(key)
    state.update(
        source="self_report" if values else ("legacy_unknown" if row else "default"),
        confidence_level="high" if values else "low",
        reported_fields=list(values),
        missing_fields=[key for key in SCORES if key not in values],
        observation_status="recorded" if values else ("unverified_legacy" if row and not known else "not_reported"),
    )
    return state


def current_day_observation(state, now):
    """User-local calendar-day boundary, not an invented hourly expiry."""
    result = dict(state)
    if not result.get('reported_fields'):
        result['current_eligible'] = False
        return result
    try:
        recorded = datetime.fromisoformat(str(result['reported_at'])) if result.get('reported_at') else datetime.fromtimestamp(result['created_at'] / 1000, timezone.utc)
        if recorded.tzinfo is None:
            raise ValueError('Timestamp needs an offset')
        eligible = recorded.astimezone(now.tzinfo).date() == now.date() and recorded <= now
    except (ValueError, TypeError, KeyError, OverflowError):
        eligible = False
    result['current_eligible'] = eligible
    if not eligible:
        result['historical_values'] = dict(result.get('historical_values') or {key: result.get(key) for key in result.get('reported_fields', [])})
        for key in FIELDS:
            result[key] = None
        result['source'] = 'historical_self_report'
        result['observation_status'] = 'not_current'
    return result


def capacity_flags(state):
    state = dict(state or {})
    if state.get("source") in {"default", "legacy_unknown", "historical_self_report"} or state.get('current_eligible') is False:
        return False, False
    values = submitted_values(state)
    high = all(key in values for key in SCORES) and values["focus"] >= 6 and values["energy"] >= 5 and values["stress"] <= 5
    low = any(key in values and (values[key] >= 6 if key == "stress" else values[key] <= 3) for key in SCORES)
    low = low or values.get("mood") in {"low", "anxious"} or values.get("readiness") in {"unsure", "need_rest"}
    return bool(high), bool(low)
