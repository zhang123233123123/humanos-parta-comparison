"""Normalize saved planning inputs into a shared, read-only rules snapshot."""
from copy import deepcopy

from ..domain.planning.activity_rules import activity_requirements
from ..domain.planning.task_priority import PLACEMENT_PRIORITY, REMAINING_TASK_TYPES
from ..domain.planning.period import day_offset


def scheduling_constraints(profile, *, tasks=(), now=None, for_validation=False):
    from humanos_graph import (build_scheduling_context, parse_available_windows,
        profile_now, day_indices_from_text, classify_weekly_activity, list_value,
        hard_constraint_intervals, subtract_interval)
    from ..domain.profile.timing import rest_minutes
    profile = deepcopy(profile)
    if now is not None:
        profile['_client_now'] = now.isoformat()
    now = profile_now(profile)
    weekly = profile.setdefault('weekly_context', {})
    from ..domain.task.schedule_constraints import task_context_items
    week_id = weekly.get('week_id') or profile.get('active_week_id')
    task_items = task_context_items(tasks, week_id, now_date=now.date()) if week_id else []
    items = [dict(item) for item in weekly.get('context_items', []) if isinstance(item, dict)]
    ids = {item['id'] for item in task_items}
    items = [item for item in items if item.get('id') not in ids] + task_items
    for item in items:
        if not item.get('days'):
            item['days'] = day_indices_from_text(str(item.get('day') or ''))
    requirements = activity_requirements(profile, items, now)
    # Both lower-priority categories use remaining capacity, never preoccupy ordinary work.
    weekly['context_items'] = [item for item in items
                              if item.get('type', item.get('category')) not in REMAINING_TASK_TYPES]
    for key in ('fixed_events', 'retained_legacy_events'):
        weekly[key] = [text for text in list_value(weekly.get(key))
                       if classify_weekly_activity(text) not in REMAINING_TASK_TYPES]
    if not for_validation:
        context = build_scheduling_context(profile)
    else:
        # Validation reads declared constraints only; no activity allocator runs here.
        hard, uncertain = hard_constraint_intervals(profile)
        rest = rest_minutes(profile.get('task_preferences') or {})
        transitions = [{**item, 'start': item['end'], 'end': min(24, item['end'] + rest / 60)}
                       for item in hard if item.get('source_type') == 'fixed_event' and rest and item['end'] < 24]
        windows = parse_available_windows(profile)
        for busy in [*hard, *transitions]:
            windows = [part for window in windows for part in
                       (subtract_interval(window, busy) if window['day_index'] == busy['day_index'] else [window])]
        convert = lambda values: [{**v, 'day_index': day_offset(profile, v['day_index'], now)} for v in values]
        context = {'windows': convert(windows), 'movable_routine_windows': convert(windows),
                   'hard_constraints': convert(hard), 'uncertain_constraints': uncertain}
    raw_available = parse_available_windows(profile)
    context['activity_availability'] = [{**w, 'day_index': day_offset(profile, w['day_index'], now)}
                                        for w in raw_available if w['end'] > w['start']]
    context['activity_requirements'] = requirements
    canonical_ids = {item['id'] for item in task_items}
    for constraint in context.get('hard_constraints', []):
        if constraint.get('context_id') in canonical_ids:
            constraint['task_id'] = constraint['context_id']
    context['timed_task_ids'] = sorted(canonical_ids)
    context['placement_priority'] = list(PLACEMENT_PRIORITY)
    return context
