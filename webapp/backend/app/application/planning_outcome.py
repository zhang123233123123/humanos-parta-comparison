"""An explained capacity shortage is reviewable, but not confirmable."""
def is_capacity_draft(decision, validation):
    violations = validation.get('violations') or []
    missing_flexible = {(item.get('source_id'), item.get('day_index'))
                        for item in decision.get('unscheduled_activities') or []
                        if item.get('kind') == 'flexible_activity'
                        and item.get('reason') == 'no_remaining_capacity'}
    def explained(violation):
        if violation.get('type') == 'empty_plan_with_active_tasks':
            return bool(decision.get('unscheduled_tasks'))
        return (violation.get('type') == 'daily_activity_capacity_insufficient'
                and (violation.get('source_id'), violation.get('day_index')) in missing_flexible)
    return bool(violations) and all(explained(v) for v in violations)
