"""Plan confirmation and activation orchestration, isolated from HTTP and Store."""
from collections.abc import Callable
from dataclasses import dataclass
from ..repositories.profiles import ProfileRepository
from ..repositories.plan_edit_episodes import PlanEditEpisodeRepository
from ..repositories.events import EventRepository
from .confirmation_validation import require_valid_confirmation
from ..domain.execution_continuation import interruption_anchor, continuation_snapshot


@dataclass(frozen=True)
class ConfirmationPorts:
    validate_confirmed_schedule: Callable
    log_event: Callable
    ensure_profile: Callable
    get_edit_episode: Callable
    canonical_plan_snapshot: Callable
    plan_hash: Callable
    canonical_plan_diff: Callable
    connect: Callable
    encode: Callable
    now: Callable
    current_week: Callable
    decode: Callable
    make_id: Callable
    _decorate_plan_blocks: Callable
    task_row: Callable
    _enqueue_personalization: Callable


def require_current_plan(conn, user_id, payload):
    """Validate identity/version before any edit or activation side effects."""
    from ..repositories.plans import PlanRepository
    plan_id = str(payload.get('plan_id') or '')
    if not plan_id:
        return None  # Preserve the existing direct-confirm command.
    row = PlanRepository(conn).get_for_user(plan_id=plan_id, user_id=user_id)
    if row is None:
        raise KeyError('Plan not found')
    import json
    policy = json.loads(row['plan_json'] or '{}').get('replan_policy') or {}
    if row['plan_status'] == 'proposed' and policy.get('rest_changes') and payload.get('rest_change_confirmation') != policy.get('rest_confirmation_id'):
        raise ValueError('请明确确认本次休息的缩短或取消后再应用。')
    if row['plan_status'] not in {'proposed', 'confirmed'}:
        raise ValueError('计划已被替代或需要重排，请刷新后确认最新草案。')
    if payload.get('plan_revision') is not None and payload['plan_revision'] != row['plan_revision']:
        raise ValueError('计划版本已变化，请刷新后重试。')
    if payload.get('week_id') and payload['week_id'] != row['week_id']:
        raise ValueError('计划所属周不匹配，请刷新后重试。')
    return row


def confirm_plan(user_id: str, payload: dict, *, ports: ConfirmationPorts) -> dict:
    from .plan_revision import activation_event_payload, activation_resources, revision_activation

    plan_id = str(payload.get("plan_id") or "")
    with ports.connect() as conn:
        existing = require_current_plan(conn, user_id, payload)
        if existing and existing['plan_status'] == 'confirmed':
            saved = ports.decode(existing['plan_json'], {})
            if saved.get('replan_policy'):
                return {'plan': saved, 'validation': saved.get('validation', {'valid': True}),
                        'replayed': True, 'resources': activation_resources(revision_activation(
                            week_id=existing['week_id'], revision=existing['plan_revision'], plan_id=plan_id))}
    plan_patch = list(payload.get("plan_patch") or [])
    validation = ports.validate_confirmed_schedule(user_id, {**payload, "plan_patch": plan_patch})
    if not validation.get("valid"):
        violations = validation.get("violations") or []
        ports.log_event(user_id, "plan_confirmation_rejected", {"violations": violations})
        require_valid_confirmation(validation)
    profile = ports.ensure_profile(user_id)
    decision_payload = dict(payload.get("decision") or {})
    episode_id = str(payload.get("edit_episode_id") or decision_payload.get("edit_episode_id") or "")
    episode = ports.get_edit_episode(user_id, episode_id) if episode_id else None
    initial_snapshot = list((episode or {}).get("initial_plan_snapshot") or plan_patch)
    final_snapshot = ports.canonical_plan_snapshot(plan_patch)
    final_hash = ports.plan_hash(final_snapshot)
    canonical_diff = ports.canonical_plan_diff(initial_snapshot, final_snapshot)
    rationale = payload.get("rationale")
    if episode and canonical_diff.get("has_changes") and rationale is None:
        with ports.connect() as conn:
            require_current_plan(conn, user_id, payload)
            PlanEditEpisodeRepository(conn).request_rationale(episode_id=episode_id, user_id=user_id,
                snapshot_json=ports.encode(final_snapshot), snapshot_hash=final_hash,
                diff_json=ports.encode(canonical_diff), timestamp=ports.now())
        return {
            "requires_rationale": True,
            "edit_episode_id": episode_id,
            "final_plan_hash": final_hash,
            "canonical_diff": canonical_diff,
            "validation": validation,
        }
    timezone_name = profile.get("timezone") or "Asia/Shanghai"
    week_id = str(payload.get("week_id") or profile.get("active_week_id") or ports.current_week(timezone_name=timezone_name))
    timestamp = ports.now()
    with ports.connect() as conn:
        from ..repositories import ExecutionSessionRepository, PlanRepository, TaskRepository
        from ..domain.task import project_confirmed_task_schedule

        plans = PlanRepository(conn)
        execution_sessions = ExecutionSessionRepository(conn)
        tasks = TaskRepository(conn)
        row = require_current_plan(conn, user_id, payload)
        if row and row["plan_status"] == "confirmed":
            result = ports.decode(row["plan_json"], {})
            return {
                "plan": result,
                "validation": validation,
                "replayed": True,
                "resources": {
                    "profile": "/api/profile",
                    "tasks": "/api/tasks",
                    "execution_sessions": "/api/execution-sessions",
                },
            }
        # Validation above is useful review feedback, not authorization to write.
        # The transaction-bound ports join the same SQLite write scope, so task
        # and profile changes cannot land between this check and activation.
        validation = ports.validate_confirmed_schedule(user_id, {**payload, "plan_patch": plan_patch})
        require_valid_confirmation(validation)
        profile = ports.ensure_profile(user_id)
        timezone_name = profile.get("timezone") or "Asia/Shanghai"
        if not row:
            revision = plans.next_revision(user_id=user_id, week_id=week_id)
            plan_id = ports.make_id("plan")
            plans.insert_proposed(
                plan_id=plan_id,
                user_id=user_id,
                week_id=week_id,
                revision=revision,
                request_id=payload.get("request_id"),
                plan_json=ports.encode({}),
                timestamp=timestamp,
            )
        else:
            revision = int(row["plan_revision"])
            week_id = str(row["week_id"])
        # Scope is loaded from the saved proposal, never from client metadata.
        scope_policy = ports.decode(row['plan_json'], {}).get('replan_policy') if row else None
        frozen_ids = {str(b['block_id']) for b in (scope_policy or {}).get('frozen_blocks', [])}
        historical_ids = set((scope_policy or {}).get('historical_block_ids', []))
        preserved_sessions = {str(s['block_id']): s for s in execution_sessions.list_for_user(user_id=user_id)
                              if s['week_id'] == week_id and s['status'] != 'superseded' and str(s['block_id']) in frozen_ids}
        activation = revision_activation(week_id=week_id, revision=revision, plan_id=plan_id)
        decorated = ports._decorate_plan_blocks(plan_patch, week_id, revision, timezone_name)
        blocks_by_task: dict[str, list[dict]] = {}
        parallel_blocks_by_group: dict[str, list[dict]] = {}
        for candidate_block in decorated:
            group_id = str(candidate_block.get("parallel_group_id") or "")
            if group_id and candidate_block.get("parallel_user_confirmed"):
                parallel_blocks_by_group.setdefault(group_id, []).append(candidate_block)
        adjustment = (scope_policy or {}).get('execution_adjustment')
        adjustment_target = None
        if adjustment:
            future = [b for b in decorated if str(b.get('task_id')) == str(adjustment['task_id']) and str(b.get('block_id')) not in historical_ids]
            if future:
                adjustment_target = min(future, key=lambda b: (int(b['day_index']), float(b['start']))).get('block_id')
        for block in decorated:
            block["plan_status"] = "confirmed"
            block.pop("applied_profile_trait_ids", None)
            block_task_id = str(block.get("task_id") or "").strip()
            if str(block.get("kind") or "") in {'fixed_event', 'recurring_routine', 'flexible_activity'} or not block_task_id:
                if block_task_id and str(block.get('source_id')) == block_task_id:
                    blocks_by_task.setdefault(block_task_id, []).append(block)
                continue
            if str(block.get('block_id')) in historical_ids:
                continue
            blocks_by_task.setdefault(block_task_id, []).append(block)
            if str(block.get('block_id')) in preserved_sessions:
                continue
            execution_id = ports.make_id("exec")
            planned_minutes = int(block.get("planned_work_minutes") or block.get("session_minutes") or round((float(block["end"]) - float(block["start"])) * 60))
            paused_source = execution_sessions.revision_continuation_source(
                user_id=user_id, task_id=block_task_id, week_id=week_id, revision=revision)
            inherited_active_minutes = int(paused_source["accumulated_active_minutes"] or 0) if paused_source else 0
            # Reviewed blocks represent new work, not lifetime cumulative work.
            # Keep their budgets unchanged; carry historical time separately.
            inherited_remaining = planned_minutes if paused_source else None
            inherited_snapshot = continuation_snapshot(
                ports.decode(paused_source['interruption_snapshot_json'], {}),
                inherited_active_minutes) if paused_source else {}
            if block.get('source_candidate_id'):
                from ..repositories.session_reports import SessionReportRepository
                pending = next(r for r in SessionReportRepository(conn).pending(user_id) if r['id'] == block['source_candidate_id'])
                source = execution_sessions.get(user_id=user_id, session_id=pending['source_session_id'])
                source_snapshot = ports.decode(source['interruption_snapshot_json'], {})
                inherited_snapshot = {k: source_snapshot[k] for k in ('progress', 'next_step') if source_snapshot.get(k)}
                inherited_active_minutes, inherited_remaining = 0, planned_minutes
                paused_source = None
            parallel_group_id = str(block.get("parallel_group_id") or "")
            group_blocks = parallel_blocks_by_group.get(parallel_group_id, [])
            parallel_context = {
                "planned_parallel": bool(parallel_group_id and len(group_blocks) == 2),
                "parallel_group_id": parallel_group_id or None,
                "parallel_role": str(block.get("parallel_role") or "member") if parallel_group_id else None,
                "partner_task_ids": sorted({str(item.get("task_id")) for item in group_blocks if str(item.get("task_id")) != block_task_id}),
                "partner_block_ids": sorted({str(item.get("block_id")) for item in group_blocks if str(item.get("block_id")) != str(block.get("block_id"))}),
                "source": "confirmed_plan",
            }
            execution_sessions.upsert_ready(
                execution_id=execution_id,
                user_id=user_id,
                task_id=block_task_id,
                block_id=str(block.get("block_id") or execution_id),
                week_id=week_id,
                revision=revision,
                planned_start_at=str(block.get("start_at") or ""),
                planned_end_at=str(block.get("end_at") or ""),
                planned_work_minutes=planned_minutes,
                resumed_from_session_id=pending['source_session_id'] if block.get('source_candidate_id') else interruption_anchor(paused_source),
                accumulated_active_minutes=inherited_active_minutes,
                remaining_at_pause=inherited_remaining,
                interruption_snapshot_json=ports.encode(inherited_snapshot),
                profile_trait_refs_json=ports.encode([]),
                parallel_context_json=ports.encode(parallel_context),
                timestamp=timestamp,
            )
            if block.get('source_candidate_id'):
                from ..repositories.session_reports import SessionReportRepository
                SessionReportRepository(conn).mark_scheduled(user_id, block['source_candidate_id'], plan_id)
            if adjustment and str(block.get('block_id')) == str(adjustment_target):
                target = execution_sessions.find_start_target(user_id=user_id, session_id=execution_id, block_id=str(block['block_id']))
                execution_sessions.set_confirmed_work(user_id=user_id, session_id=target['id'],
                    minutes=adjustment['duration_minutes'], baseline_seconds=inherited_active_minutes * 60, timestamp=timestamp)
            if paused_source:
                execution_sessions.mark_continued_in_revision(session_id=paused_source["id"], timestamp=timestamp)
        active_rows = tasks.active_for_week(user_id=user_id, week_id=week_id)
        for task_row in active_rows:
            task = ports.task_row(task_row)
            task_id = str(task["id"])
            if scope_policy and task_id not in scope_policy['allowed_task_ids']:
                continue
            projection = project_confirmed_task_schedule(
                task,
                sessions=[b for b in blocks_by_task.get(task_id, []) if not b.get('source_candidate_id')],
                week_id=week_id,
                revision=revision,
            )
            tasks.save_schedule_projection(
                task_id=task_id,
                user_id=user_id,
                slot_json=ports.encode(projection.slot),
                execution_json=ports.encode(projection.execution),
                status=projection.status,
                timestamp=timestamp,
            )
        stored = dict(payload.get("decision") or {})
        if scope_policy:
            stored['replan_policy'] = scope_policy
        stored.update({"plan_id": plan_id,"plan_revision": revision,"plan_status": "confirmed","week_id": week_id,"plan_patch": decorated,"confirmed_at": timestamp})
        from .build_timeline import build_weekly_timeline_snapshot

        stored["weekly_timeline"] = build_weekly_timeline_snapshot(
            week_id=week_id,
            timezone_name=timezone_name,
            blocks=decorated,
        )
        from .project_plan import project_plan_for_persistence

        stored = project_plan_for_persistence(stored, profile=profile)
        if episode:
            rationale_payload = dict(rationale or {})
            if canonical_diff.get("has_changes"):
                rationale_request_id = str(rationale_payload.get("request_id") or "").strip() or None
                existing_rationale = PlanEditEpisodeRepository(conn).find_rationale(
                    episode_id=episode_id, snapshot_hash=final_hash)
                if not existing_rationale:
                    raw_response = str(rationale_payload.get("raw_user_response") or "")
                    reason_codes = list(rationale_payload.get("reason_codes") or [])
                    parsed_reason = dict(rationale_payload.get("parsed_reason") or {"reason_codes": reason_codes, "raw_text": raw_response})
                    rationale_id = ports.make_id("rationale")
                    PlanEditEpisodeRepository(conn).insert_rationale(
                        rationale_id=rationale_id, episode_id=episode_id, user_id=user_id,
                        plan_id=plan_id, revision=revision, snapshot_hash=final_hash,
                        reason_codes_json=ports.encode(reason_codes), raw_response=raw_response,
                        parsed_reason_json=ports.encode(parsed_reason),
                        generalizability=rationale_payload.get("generalizability") or "not_sure",
                        affected_ids_json=ports.encode(rationale_payload.get("affected_task_ids") or []),
                        response_status=rationale_payload.get("response_status") or "answered",
                        source_json=ports.encode({"observed": "system_observed", "reported": "user_self_report", "parsed": "ai_inference" if raw_response else None}),
                        request_id=rationale_request_id, timestamp=timestamp)
                    affected_ids = [str(item) for item in (rationale_payload.get("affected_task_ids") or []) if str(item)]
                    rationale_task_row = tasks.get_for_user(task_id=affected_ids[0], user_id=user_id) if len(affected_ids) == 1 else None
                    ports._enqueue_personalization(
                        conn, user_id=user_id, kind="plan_rationale", source_id=rationale_id, timestamp=timestamp,
                        payload={
                            "user_id": user_id, "rationale_id": rationale_id, "observed_at": timestamp,
                            "rationale": rationale_payload, "canonical_diff": canonical_diff,
                            "task": ports.task_row(rationale_task_row) if rationale_task_row else None,
                        },
                    )
            PlanEditEpisodeRepository(conn).confirm(episode_id=episode_id, user_id=user_id,
                snapshot_json=ports.encode(final_snapshot), snapshot_hash=final_hash,
                diff_json=ports.encode(canonical_diff), timestamp=timestamp)
        plans.supersede_other_revisions(
            user_id=user_id,
            week_id=activation.week_id,
            active_plan_id=activation.plan_id,
            timestamp=timestamp,
        )
        # A confirmed revision is the single source of future calendar
        # truth. Keep completed/ended/running history, but retire unstarted
        # and paused Sessions from earlier revisions so they cannot reappear
        # in Now / Up Next after the user confirms a replacement plan.
        execution_sessions.supersede_older_future_sessions(
            user_id=user_id,
            week_id=activation.week_id,
            active_revision=activation.revision,
            timestamp=timestamp,
            preserved_ids=[s['id'] for s in preserved_sessions.values()],
        )
        plans.confirm(
            plan_id=plan_id,
            user_id=user_id,
            plan_json=ports.encode(stored),
            timestamp=timestamp,
        )
        ProfileRepository(conn).activate_plan(user_id=user_id, week_id=week_id,
            revision=revision, timestamp=timestamp)
        EventRepository(conn).insert(event_id=ports.make_id("evt"), user_id=user_id,
            event_type="plan_confirmed", payload_json=ports.encode(activation_event_payload(activation)),
            timestamp=timestamp)
    return {
        "plan": stored,
        "validation": validation,
        "replayed": False,
        "requires_rationale": False,
        "edit_episode_id": episode_id or None,
        "canonical_diff": canonical_diff,
        "resources": activation_resources(activation),
    }
