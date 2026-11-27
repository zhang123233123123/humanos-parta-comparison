import { draftInstant, wallParts } from '../calendar-draft-time'
import type { CandidateWork, PlanAuthorization, RuntimeProposal, SessionReport } from '../interaction/contracts'
import type { DailyPlanReview } from '../contracts/checkin-contracts'

type Data = Record<string, any>
type Context = { store: Data; today: string; id: () => string; save: () => void; makeTask: (input: Data) => Data }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const scenarios = ['keep', 'propose', 'error'] as const

/** Explicit, browser-session fixtures. Never used by the live interaction adapter. */
export function createFeedbackFixtures({ store: s, today, id, save, makeTask }: Context) {
  const state = () => (s.interaction ||= { scenario: 'keep', fixture_loaded: false, candidates: [], reports: {}, session_status: {}, proposals: {}, applied_requests: {} })
  const instant = (day: number, hour: number) => draftInstant(s.profile.active_week_id, day, hour, s.profile.timezone)
  const now = () => state().fixture_loaded ? state().now : Date.now()
  const stamp = () => new Date(now()).toISOString()
  const reply = (data: Data, status = 200) => { save(); return Response.json({ data, ...data }, { status }) }
  const fail = (message: string, status = 422) => Response.json({ message }, { status })
  const sessionId = (block: Data) => `session-${block.block_id}`
  const sessionStatus = (block: Data) => state().session_status[sessionId(block)] || 'ready'
  const future = () => (s.active?.plan_patch || []).filter((b: Data) => b.kind === 'task_session' && sessionStatus(b) === 'ready' && !state().started?.[sessionId(b)] && Date.parse(b.start_at) >= now())
  const makeState = (values: Data) => ({ ...values, id: id(), user_id: s.profile.user_id, local_date: wallParts(new Date(now()), s.profile.timezone).date,
    reported_at: stamp(), created_at: stamp(), reported_fields: ['mood', 'energy', 'focus', 'stress', 'daily_note'] })
  const validState = (values: Data | undefined) => values && ['positive', 'neutral', 'low', 'anxious'].includes(values.mood)
    && ['energy', 'focus', 'stress'].every(key => Number.isInteger(values[key]) && values[key] >= 1 && values[key] <= 7)
  const scenarioInfo = () => ({ scenario: state().scenario, fixture_loaded: state().fixture_loaded,
    source_session_id: state().source_session_id || null, local_date: s.profile.active_week_id })

  function seed(scenario: typeof scenarios[number], journey = 'feedback') {
    s.profile.active_week_id = today
    s.profile.research_context = { ...s.profile.research_context, onboarding_submitted: true, onboarding_completed: true }
    s.profile.weekly_context = { ...s.profile.weekly_context, weekly_available_windows: 'Monday-Sunday 08:00-21:00' }
    const taskA = makeTask({ title: '阅读并整理研究文献', status: 'scheduled', duration: 135, priority: 'high', expected_difficulty: 5, deadline_at: instant(2, 18) })
    const taskB = makeTask({ title: '整理实验记录', status: 'scheduled', duration: 30, priority: 'medium', expected_difficulty: 3, deadline_at: instant(3, 18) })
    const meeting = makeTask({ title: '导师讨论会', task_type: 'fixed_event', status: 'scheduled', duration: 60, start_at: instant(0, 13), end: instant(0, 14) })
    const block = (task: Data, start: number, minutes: number) => ({ block_id: id(), task_id: task.id, title: task.title,
      kind: 'task_session', day_index: 0, start, end: start + minutes / 60, start_at: instant(0, start), end_at: instant(0, start + minutes / 60),
      planned_work_minutes: minutes, session_minutes: minutes })
    const blocks = [block(taskA, 9, 45), block(taskA, 11, 45), block(taskA, 16, 45), block(taskB, 14, 30)]
    s.tasks = [taskA, taskB, meeting]
    s.active = { plan_id: id(), plan_revision: 1, plan_status: 'confirmed', week_id: today, action: 'propose_schedule',
      plan_patch: blocks, requires_confirmation: false, candidate_plans: [], unscheduled_tasks: [], task_ids: [taskA.id, taskB.id],
      explanation: '前端反馈流程演示安排。', validation: { valid: true, violations: [] },
      constraint_summary: { windows: [], hard_constraints: [] }, personalization: { applied_traits: [], available_trait_ids: [] } }
    s.proposed = null; s.jobs = {}; s.edits = []
    s.interaction = { scenario, journey, active_session_id: null, started: {}, fixture_loaded: true, now: Date.parse(instant(0, journey === 'feedback' ? 10 : 8.5)), source_session_id: sessionId(blocks[0]),
      candidates: [], reports: {}, session_status: {}, proposals: {}, applied_requests: {}, runtime_proposal: null,
      work_suggestions: [{kind:'rest'}, {kind:'scope'}, {kind:'switch',session_id:sessionId(blocks[3])}],
      breaks: [{ id: id(), title: '休息 · 散步', start: instant(0, 12.25), end: instant(0, 12.5), editable: false,
        extendedProps: { taskType: 'flexible_activity', status: 'scheduled' } }] }
    s.state = makeState({ mood: 'neutral', energy: 5, focus: 5, stress: 3, daily_note: '' })
    if (journey === 'daily') s.state.reported_at = instant(-1, 10)
  }

  function review(): DailyPlanReview {
    const first = [...future()].sort((a: Data, b: Data) => Date.parse(a.start_at) - Date.parse(b.start_at))[0]
    const error = state().scenario === 'error'
    const adjust = state().scenario === 'propose' && Boolean(first)
    const reported = ['energy', 'focus', 'stress'].filter(key => Number.isInteger(s.state?.[key]))
      .map(key => `${({ energy: '精力', focus: '专注', stress: '压力' } as Data)[key]}${s.state[key]}/7`).join('、')
    const task = first ? s.tasks.find((item: Data) => item.id === first.task_id) : null
    const demand = first ? `接下来「${first.title}」安排了${first.planned_work_minutes}分钟${Number.isFinite(task?.expected_difficulty) ? `，难度${task.expected_difficulty}/7` : ''}` : '当前没有尚未开始的工作段'
    const recommendedStart = adjust ? instant(first.day_index, first.start + .25) : null
    const recommendedTime = recommendedStart ? wallParts(new Date(recommendedStart), s.profile.timezone) : null
    const timeLabel = recommendedTime ? `${String(Math.floor(recommendedTime.hour)).padStart(2, '0')}:${String(Math.round((recommendedTime.hour % 1) * 60)).padStart(2, '0')}` : ''
    // Describe actual input and this fixture's concrete proposal. A deterministic
    // scenario is not evidence of declining energy, a habit, or a past pattern.
    const reason = error ? '状态已保存，但暂时无法检查接下来的安排。原计划没有改变。'
      : `${reported ? `你刚报告${reported}；` : ''}${demand}。${adjust
        ? `建议把这段工作推迟15分钟至${timeLabel}开始，留出过渡时间，其他安排不变。`
        : first ? '本次检查未建议改变这段工作的时间或用时。' : '当前安排没有变化。'}`
    return { assessment_status: error ? 'unavailable' : 'completed', decision: error ? null : adjust ? 'suggest_adjustment' : 'keep_plan',
      reason,
      affected_task_ids: adjust ? [first.task_id] : [], missing_information: [], state_id: s.state?.id || null,
      plan_id: s.active?.plan_id || null, requires_plan_adjustment: adjust, evaluated_at: stamp(),
      first_session: first ? { execution_session_id: sessionId(first), task_id: first.task_id, task_title: first.title,
        planned_start_at: first.start_at, planned_end_at: first.end_at, planned_work_minutes: first.planned_work_minutes } : null,
      ...(recommendedStart ? { recommendation: { start_at: recommendedStart, duration_minutes: first.planned_work_minutes } } : {}),
      reason_codes: [], options: adjust ? ['adjust_today', 'keep_plan'] : ['keep_plan'] }
  }

  function proposalViolations(plan: Data): Data[] {
    const proposal: RuntimeProposal | null = state().runtime_proposal || null
    if (!proposal || plan.plan_id !== proposal.id) return []
    const errors: Data[] = []
    if (proposal.authorization.base_plan_id !== s.active?.plan_id || proposal.authorization.base_plan_revision !== s.active?.plan_revision
      || proposal.authorization.base_state_id !== s.state?.id) errors.push({ message: '安排或状态已变化，请重新生成候选调整。' })
    const patch: Data[] = plan.plan_patch || []
    const authorized = new Set(proposal.authorization.adjustable_session_ids)
    const source = s.active?.plan_patch || []
    for (const old of source) {
      const next = patch.find(b => b.block_id === old.block_id)
      if (next && state().started?.[sessionId(old)] && (next.start !== old.start || next.end !== old.end || next.day_index !== old.day_index)) errors.push({ message: '这段工作已经开始，请重新检查接下来的安排。' })
      if (!next || next.planned_work_minutes !== old.planned_work_minutes || next.task_id !== old.task_id) errors.push({ message: '请保留已有工作段及其工作量。' })
      else if (!authorized.has(sessionId(old)) && (next.start !== old.start || next.end !== old.end || next.day_index !== old.day_index)) errors.push({ message: '这段安排不在本次允许调整的范围内。' })
    }
    const protectedTimes = [...s.tasks.filter((t: Data) => t.task_type === 'fixed_event').map((t: Data) => ({ start: t.start_at, end: t.end })), ...(state().breaks || [])]
    for (const b of patch) {
      if (b.execution_status === 'deferred') continue
      if (b.start < 8 || b.end > 21 || b.day_index < 0 || b.day_index > 6) errors.push({ message: '请把工作段放在本次规划期的可用时间内。' })
      const start = Date.parse(instant(b.day_index, b.start)), end = Date.parse(instant(b.day_index, b.end))
      if (protectedTimes.some(t => start < Date.parse(t.end) && end > Date.parse(t.start))) errors.push({ message: '工作段与固定活动或休息重叠，请调整时间。' })
    }
    for (let a = 0; a < patch.length; a++) for (let b = a + 1; b < patch.length; b++) {
      if (patch[a].execution_status === 'deferred' || patch[b].execution_status === 'deferred') continue
      if (patch[a].day_index === patch[b].day_index && patch[a].start < patch[b].end && patch[a].end > patch[b].start) errors.push({ message: '工作段之间不能重叠。' })
    }
    return errors
  }

  function confirmProposal(plan: Data) {
    const proposal = state().runtime_proposal
    if (!proposal || plan.plan_id !== proposal.id) return
    for (const candidate of state().candidates) if (plan.plan_patch.some((b: Data) => b.source_candidate_id === candidate.id)) candidate.status = 'scheduled'
    proposal.status = 'applied'; state().last_applied_proposal = clone(proposal); state().runtime_proposal = null
  }
  function rejectProposal() { state().runtime_proposal = null }

  function retain(block: Data, minutes: number | null, source: CandidateWork['source']) {
    const task = s.tasks.find((t: Data) => t.id === block.task_id)
    const siblings = s.active.plan_patch.filter((b: Data) => b.task_id === block.task_id).sort((a: Data, b: Data) => a.start_at.localeCompare(b.start_at))
    const ordinal = siblings.findIndex((b: Data) => b.block_id === block.block_id) + 1
    state().candidates.push({ id: id(), original_task_id: block.task_id, source_session_id: sessionId(block),
      title: `${block.title} · 第 ${ordinal} 段${source === 'interrupted_session' ? '未完成部分' : ''}`,
      remaining_minutes: minutes, source, status: 'pending', deadline: task?.deadline_at || null, planning_period_end: instant(6, 24) })
  }

  async function handle(path: string, method: string, body: Data): Promise<Response | null> {
    if (!path.startsWith('/api/demo/interaction/')) return null
    if (path.endsWith('/scenario')) {
      if (method === 'POST') {
        if (!scenarios.includes(body.scenario)) return fail('请选择 keep、propose 或 error 演示情境。')
        seed(body.scenario, body.journey)
      }
      return reply(scenarioInfo())
    }
    if (path.endsWith('/snapshot')) return reply({ ...scenarioInfo(), candidates: state().candidates, active_session_id: state().active_session_id || null, started: state().started || {}, runtime_proposal: state().runtime_proposal || null,
      ...(state().fixture_loaded ? { now: state().now, clock_rate: 0 } : {}) })
    if (path.endsWith('/clock') && method === 'POST') {
      if (!state().fixture_loaded || !Number.isFinite(body.hour) || body.hour < 0 || body.hour > 24) return fail('请先加载演示场景并选择有效时间。')
      state().now = Date.parse(instant(body.day === 1 ? 1 : 0, body.hour))
      return reply({ now: state().now })
    }
    if (path.endsWith('/start') && method === 'POST') {
      if (!body.request_id) return fail('缺少操作标识。')
      if (state().reports[body.request_id]) return reply({ started: true })
      if (body.base_plan_revision !== s.active?.plan_revision || (body.expected_active_id || null) !== (state().active_session_id || null)) return fail('当前工作或安排已变化，请重新查看。', 409)
      const block = s.active?.plan_patch.find((b: Data) => sessionId(b) === body.session_id && b.kind === 'task_session')
      if (!block || sessionStatus(block) !== 'ready' || wallParts(new Date(block.start_at), s.profile.timezone).date !== wallParts(new Date(now()), s.profile.timezone).date) return fail('请选择今天尚未结束的工作段。', 409)
      if (body.remaining_minutes != null && (!Number.isInteger(body.remaining_minutes) || body.remaining_minutes < 1 || body.remaining_minutes > 10080)) return fail('请输入有效分钟数。')
      const previous = s.active.plan_patch.find((b: Data) => sessionId(b) === state().active_session_id)
      if (previous && sessionId(previous) !== body.session_id) {
        state().session_status[sessionId(previous)] = 'interrupted'
        if (body.retain_previous) retain(previous, body.remaining_minutes ?? null, 'interrupted_session')
      }
      state().active_session_id = body.session_id
      ;(state().started ||= {})[body.session_id] ||= stamp()
      state().reports[body.request_id] = { started: true }
      return reply({ started: true })
    }
    if (path.endsWith('/review')) return reply({ daily_plan_review: review() })
    if (path.endsWith('/report') && method === 'POST') {
      const command = body as SessionReport
      if (!command.request_id) return fail('缺少反馈请求标识。')
      if (state().reports[command.request_id]) return reply(clone(state().reports[command.request_id]))
      if (!s.active || command.plan_id !== s.active.plan_id || command.plan_revision !== s.active.plan_revision) return fail('安排已变化，请重新打开当前工作段。', 409)
      const block = s.active.plan_patch.find((b: Data) => sessionId(b) === command.source_session_id && b.task_id === command.original_task_id)
      if (!block || sessionStatus(block) !== 'ready') return fail('这段工作不存在或已经反馈。', 409)
      if (!['completed', 'interrupted'].includes(command.outcome) || !validState(command.state)) return fail('请填写完整的状态反馈。')
      if (command.remaining_minutes !== null && (!Number.isInteger(command.remaining_minutes) || command.remaining_minutes <= 0)) return fail('剩余用时需要是正整数分钟。')
      s.state = makeState(command.state)
      state().session_status[command.source_session_id] = command.outcome
      if (state().active_session_id === command.source_session_id) state().active_session_id = null
      if (command.outcome === 'interrupted' && command.retain_candidate) {
        retain(block, command.remaining_minutes, 'interrupted_session')
      }
      const result = { runtime_state: clone(s.state), daily_plan_review: review() }
      state().reports[command.request_id] = result
      state().last_report = clone(command)
      state().session_reports ||= {}
      state().session_reports[command.source_session_id] = clone(command)
      return reply(result)
    }
    if (path.endsWith('/propose') && method === 'POST') {
      const auth = body as PlanAuthorization
      if (!auth.request_id) return fail('缺少候选调整请求标识。')
      const existing = state().proposals[auth.request_id]
      if (existing && s.proposed?.plan_id === existing.runtime_proposal.id) return reply(clone(existing))
      if (!s.active || auth.base_plan_id !== s.active.plan_id || auth.base_plan_revision !== s.active.plan_revision || auth.base_state_id !== s.state?.id) return fail('安排或状态已变化，请重新查看调整建议。', 409)
      if (state().scenario === 'error') return fail('本次演示无法生成调整，反馈与原计划都已保留。', 503)
      if (!['today', 'remaining_planning_period'].includes(auth.scope) || !Array.isArray(auth.adjustable_session_ids) || !Array.isArray(auth.authorized_candidate_ids)) return fail('请选择本次允许调整的范围。')
      if (auth.local_date !== wallParts(new Date(now()), s.profile.timezone).date) return fail('当前日期已变化，请重新查看调整建议。', 409)
      const allowed = future().filter((b: Data) => auth.scope !== 'today' || wallParts(new Date(b.start_at), s.profile.timezone).date === auth.local_date)
      if (auth.adjustable_session_ids.some(value => !allowed.some((b: Data) => sessionId(b) === value))) return fail('所选工作段已开始、已反馈或不在本次调整范围内。', 409)
      const candidateIds = new Set(auth.authorized_candidate_ids)
      if ([...candidateIds].some(value => !state().candidates.some((c: CandidateWork) => c.id === value && c.status === 'pending'))) return fail('待安排工作已变化，请重新选择。', 409)
      const eligible = allowed.filter((b: Data) => auth.adjustable_session_ids.includes(sessionId(b))).sort((a: Data, b: Data) => a.start_at.localeCompare(b.start_at))
      if (!eligible.length && !candidateIds.size) return fail('当前没有可调整的后续工作段。')
      const plan = { ...clone(s.active), plan_id: id(), plan_revision: s.active.plan_revision + 1, plan_status: 'proposed', requires_confirmation: true,
        personalization: { ...s.active.personalization, current_state_evidence: { state_id: s.state.id } } }
      const changes: RuntimeProposal['changes'] = []
      if (eligible.length) {
        const old = eligible[0], changed = plan.plan_patch.find((b: Data) => b.block_id === old.block_id)
        changed.start += .25; changed.end += .25; changed.start_at = instant(changed.day_index, changed.start); changed.end_at = instant(changed.day_index, changed.end)
        changes.push({ session_id: sessionId(old), title: old.title, before: old.start_at, after: changed.start_at })
      }
      let cursor = 15
      const unallocated: string[] = []
      for (const candidate of state().candidates as CandidateWork[]) if (candidateIds.has(candidate.id)) {
        const duration = auth.candidate_duration_minutes?.[candidate.id] ?? candidate.remaining_minutes
        if (!Number.isInteger(duration) || Number(duration) <= 0 || cursor + Number(duration) / 60 > 21) { unallocated.push(candidate.id); continue }
        const b = { block_id: id(), task_id: candidate.original_task_id, title: candidate.title, kind: 'task_session', day_index: 0,
          start: cursor, end: cursor + Number(duration) / 60, planned_work_minutes: duration, session_minutes: duration, source_candidate_id: candidate.id,
          start_at: instant(0, cursor), end_at: instant(0, cursor + Number(duration) / 60) }
        plan.plan_patch.push(b); changes.push({ session_id: candidate.id, title: b.title, before: null, after: b.start_at }); cursor = b.end + .25
      }
      const runtime: RuntimeProposal = { id: plan.plan_id, authorization: clone(auth), valid: true, status: 'proposed', changes, unallocated_candidate_ids: unallocated }
      const previousRuntime = state().runtime_proposal
      state().runtime_proposal = runtime
      const violations = proposalViolations(plan)
      if (violations.length) { state().runtime_proposal = previousRuntime; return fail(violations[0].message) }
      s.proposed = plan
      const result = { runtime_proposal: runtime, plan }
      state().proposals[auth.request_id] = clone(result)
      return reply(result)
    }
    if (path.endsWith('/apply') && method === 'POST') {
      if (!body.request_id) return fail('缺少应用请求标识。')
      if (state().applied_requests[body.request_id]) return reply({ applied: true })
      const proposal = state().runtime_proposal as RuntimeProposal | null
      if (!proposal || body.proposal?.id !== proposal.id || s.proposed?.plan_id !== proposal.id || proposal.authorization.base_plan_id !== s.active?.plan_id
        || proposal.authorization.base_plan_revision !== s.active?.plan_revision || proposal.authorization.base_state_id !== s.state?.id) return fail('这份候选调整已变化，请重新预览。', 409)
      const violations = proposalViolations(s.proposed)
      if (violations.length) return fail(violations[0].message)
      s.active = { ...clone(s.proposed), plan_status: 'confirmed', requires_confirmation: false }; s.proposed = null
      confirmProposal(s.active); state().applied_requests[body.request_id] = true
      return reply({ applied: true })
    }
    if (path.endsWith('/defer') && method === 'POST') {
      if (!body.request_id || body.confirmed_not_started !== true || body.base_plan_revision !== s.active?.plan_revision) return fail('请确认这段工作尚未开始，并重新读取安排。', 409)
      if (state().reports[body.request_id]) return reply({ deferred: true })
      const block = s.active.plan_patch.find((b: Data) => sessionId(b) === body.session_id && b.kind === 'task_session' && sessionStatus(b) === 'ready' && !state().started?.[body.session_id])
      if (!block) return fail('这段工作已经开始、已反馈或不存在。', 409)
      state().session_status[body.session_id] = 'deferred'
      block.execution_status = 'deferred'
      retain(block, block.planned_work_minutes, 'explicitly_deferred_session')
      s.active.plan_revision++
      state().reports[body.request_id] = { deferred: true }
      return reply({ deferred: true })
    }
    return fail('此演示操作尚未提供。', 501)
  }
  return { handle, proposalViolations, confirmProposal, rejectProposal }
}
