import { createDemoWorkController, registerDemoWorkController } from './work-actions'
import { DEMO_USER, demoSession } from './config'
import { draftInstant, wallParts } from '../calendar-draft-time'
import { createFeedbackFixtures } from './feedback-fixtures'

type Store = Pick<Storage, 'getItem' | 'setItem'>
type RecordData = Record<string, any>
const KEY = 'humanos:demo-session:v1'
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
const envelope = (data: RecordData) => ({ data, resources: {}, meta: { read_only: false } })
const json = (body: unknown, status = 200) => Response.json(body, { status })

/** Browser-only simulation of the existing frontend HTTP contracts. No network calls. */
export function createDemoApi(storage: Store, now = new Date(), timezone = 'Europe/Amsterdam') {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(now)
  const id = () => `demo-${crypto.randomUUID()}`
  const timestamp = () => new Date(s?.interaction?.fixture_loaded ? s.interaction.now : Date.now()).toISOString()
  let s: RecordData
  const time = (day: number, hour: number) => draftInstant(s.profile.active_week_id, day, hour, s.profile.timezone)
  const save = () => storage.setItem(KEY, JSON.stringify(s))
  const makeTask = (input: RecordData) => ({ id: input.id || id(), user_id: DEMO_USER, title: input.title || input.summary || '演示任务', task_type: 'flexible_task', status: 'queued', duration: 45, priority: 'medium', context: '', resource_modality: [], ...input })
  const makePlan = () => {
    const tasks = s.tasks.filter((t: RecordData) => t.task_type !== 'fixed_event' && !['completed', 'terminated'].includes(t.status))
    const blocks: RecordData[] = []
    // Deliberate demo layout, not the production scheduler or AI output.
    tasks.forEach((t: RecordData, index: number) => {
      let remaining = Number(t.duration) || 45
      let part = 0
      while (remaining > 0 && part < 14) {
        const minutes = Math.min(remaining, Number(s.profile.task_preferences.preferred_session_minutes) || 45)
        const ordinal = index + part * Math.max(tasks.length, 1)
        const day = Math.floor(ordinal / 4) % 7
        const start = [9, 11, 14, 16][ordinal % 4]
        blocks.push({ block_id: id(), task_id: t.id, title: t.title, kind: 'task_session', day_index: day, start, end: start + minutes / 60,
          start_at: time(day, start), end_at: time(day, start + minutes / 60), planned_work_minutes: minutes, session_minutes: minutes })
        remaining -= minutes; part++
      }
    })
    return { plan_id: id(), plan_revision: 1, plan_status: 'proposed', week_id: s.profile.active_week_id,
      action: 'propose_schedule', plan_patch: blocks, requires_confirmation: true, candidate_plans: [], unscheduled_tasks: [],
      task_ids: tasks.map((t: RecordData) => t.id), explanation: '演示排布，仅用于检查界面和交互，未调用 AI。',
      validation: { valid: true, violations: [] }, constraint_summary: { windows: [], hard_constraints: [] },
      personalization: { applied_traits: [], available_trait_ids: [], current_state_evidence: { state_id: s.state?.id } } }
  }
  const sessions = () => (s.active?.plan_patch || []).filter((b: RecordData) => b.kind === 'task_session').map((b: RecordData) => ({
    execution_session_id: `session-${b.block_id}`, task_id: b.task_id, task_title: b.title, block_id: b.block_id,
    plan_id: s.active.plan_id, plan_revision: s.active.plan_revision, status: s.interaction?.session_status?.[`session-${b.block_id}`] || 'ready', planned_start_at: b.start_at || time(b.day_index, b.start),
    pause_reason: s.interaction?.work_notes?.[`session-${b.block_id}`]?.reason || s.interaction?.session_reports?.[`session-${b.block_id}`]?.reason,
    interruption_snapshot: { progress: s.interaction?.work_notes?.[`session-${b.block_id}`]?.progress || s.interaction?.session_reports?.[`session-${b.block_id}`]?.progress, next_step: s.interaction?.work_notes?.[`session-${b.block_id}`]?.next },
    planned_end_at: b.end_at || time(b.day_index, b.end), planned_work_minutes: b.planned_work_minutes,
  }))
  const updateProfile = (p: RecordData) => {
    for (const [key, value] of Object.entries(p)) s.profile[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...s.profile[key], ...value } : value
    s.profile.user_id = DEMO_USER
  }
  const removeTask = (taskId: string) => {
    s.tasks = s.tasks.filter((t: RecordData) => t.id !== taskId)
    for (const plan of [s.active, s.proposed]) if (plan) { plan.plan_patch = plan.plan_patch.filter((b: RecordData) => b.task_id !== taskId); plan.plan_revision++ }
  }
  const validation = (plan: RecordData) => {
    const violations: RecordData[] = []
    if (!Array.isArray(plan.plan_patch)) violations.push({ message: '演示计划缺少时间块。' })
    for (const b of plan.plan_patch || []) if (b.end <= b.start || b.start < 0 || b.end > 24 || (b.end - b.start) * 60 + .01 < b.planned_work_minutes) violations.push({ message: '请填写有效的时间范围，并保留任务用时。' })
    violations.push(...feedback.proposalViolations(plan))
    return { valid: violations.length === 0, violations }
  }
  try { s = JSON.parse(storage.getItem(KEY) || 'null') } catch { s = null! }
  if (!s) {
    s = { profile: { user_id: DEMO_USER, timezone, active_week_id: today, role: 'research_student', blocker_patterns: [],
      task_preferences: { preferred_session_minutes: 45, rest_between_tasks_minutes: 10, learning_mode: 'reading_writing', typical_energy: { morning: 6, afternoon: 4, evening: 3 } },
      weekly_context: { weekly_goal: '完成文献梳理与研究汇报', weekly_available_windows: 'Monday-Sunday 08:00-21:00', context_items: [] },
      research_context: { onboarding_submitted: true, onboarding_completed: false, onboarding_step: 0 } },
      tasks: [], active: null, proposed: null, jobs: {}, state: { id: id(), mood: 'neutral', energy: 5, focus: 5, stress: 3, daily_note: '今天先做阅读，再准备讨论。', reported_at: now.toISOString(), created_at: now.toISOString(), reported_fields: ['mood', 'energy', 'focus', 'stress', 'daily_note'] } }
    s.tasks = [makeTask({ title: '阅读并整理两篇研究文献', duration: 90, priority: 'high', expected_difficulty: 6, deadline_at: time(2, 18) }),
      makeTask({ title: '准备导师讨论提纲', duration: 45, expected_difficulty: 4, deadline_at: time(1, 18) }),
      makeTask({ title: '整理本周实验记录', duration: 30, expected_difficulty: 3, deadline_at: time(3, 18) }),
      makeTask({ title: '导师讨论会', task_type: 'fixed_event', status: 'scheduled', duration: 60, start_at: time(0, 13), end: time(0, 14) })]
    s.proposed = makePlan(); save()
  }
  registerDemoWorkController(createDemoWorkController(s, save, id))
  const feedback = createFeedbackFixtures({ store: s, today, id, save, makeTask })
  const prefill = () => ({ step: 0, timezone: s.profile.timezone, role: s.profile.role, learningMode: s.profile.task_preferences.learning_mode,
    state_input_version: 2, difficulty_input_version: 1, sessionMinutes: s.profile.task_preferences.preferred_session_minutes,
    breakMinutes: s.profile.task_preferences.rest_between_tasks_minutes, dayEnergy: s.profile.task_preferences.typical_energy,
    arrangement: {}, availableWindows: s.profile.weekly_context.weekly_available_windows, weeklyGoal: s.profile.weekly_context.weekly_goal,
    contextItems: s.profile.weekly_context.context_items, momentary: s.state,
    tasks: s.tasks.filter((t: RecordData) => t.task_type !== 'fixed_event').map((t: RecordData) => ({ ...t, deadline_at: String(t.deadline_at || '').slice(0, 16), dependency: '', expected_difficulty: t.expected_difficulty ?? null })) })

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, method = request.method
    const body: RecordData = ['GET', 'HEAD'].includes(method) ? {} : await request.json().catch(() => ({}))
    const done = (data: unknown, status = 200) => { save(); return json(data, status) }
    const interaction = await feedback.handle(path, method, body)
    if (interaction) return interaction
    if (path === '/api/auth/session') return json(demoSession)
    if (path === '/api/auth/csrf') return json({ csrfToken: 'demo-only' })
    if (path === '/api/auth/signout') return json({ url: '/app/onboarding?edit=1' })
    if (path === '/api/health') return json({ ok: true, ai_enabled: false, ai_model: '演示数据（不调用 AI）', test_mode: false, qa_mode: false })
    if (path === '/api/account/capabilities') return json({ test_clock: false, qa_tools: false })
    if (path === '/api/profile') { if (method === 'PUT') updateProfile(body); return done(envelope({ profile: s.profile })) }
    if (path === '/api/dev/onboarding-prefill' || path === '/api/dev/demo-onboarding') return json({ draft: prefill() })
    if (path === '/api/weekly-setup/reconcile') {
      updateProfile(body.profile || {})
      const submittedIds = new Set<string>()
      for (const task of body.tasks || []) {
        const index = s.tasks.findIndex((t: RecordData) => (task.id && t.id === task.id) || (task.request_id && (t.id === task.request_id || t.request_id === task.request_id)))
        const saved = index >= 0 ? { ...s.tasks[index], ...task } : makeTask(task)
        if (index >= 0) s.tasks[index] = saved
        else s.tasks.push(saved)
        submittedIds.add(saved.id)
      }
      // Reconcile replaces this demo's work-task inputs; meetings remain independent.
      if (Array.isArray(body.tasks)) s.tasks = s.tasks.filter((t: RecordData) => t.task_type === 'fixed_event' || submittedIds.has(t.id))
      return done(envelope({ profile: s.profile, tasks: s.tasks }))
    }
    if (path === '/api/state-checkins') {
      if (method === 'POST') {
        s.state = { ...body, id: id(), user_id: DEMO_USER, reported_at: timestamp(), created_at: timestamp(), reported_fields: ['mood', 'energy', 'focus', 'stress', 'daily_note'] }
        return done(envelope({ runtime_state: s.state, daily_plan_review: null }))
      }
      const local = wallParts(new Date(timestamp()), s.profile.timezone).date
      const reported = s.state?.reported_at ? wallParts(new Date(s.state.reported_at), s.profile.timezone).date : null
      return json({ required: reported !== local, local_date: local, last_daily_checkin_date: reported, evaluated_at: timestamp(), runtime_state: s.state })
    }
    if (path === '/api/state-checkins/review') return json(envelope({ daily_plan_review: null }))
    if (path === '/api/tasks/parse') return json({ message: '演示模式不调用 AI 解析，请使用任务表单填写。' }, 501)
    if (path === '/api/tasks' || /^\/api\/tasks\/[^/]+$/.test(path)) {
      const taskId = path === '/api/tasks' ? body.id || body.task_id : decodeURIComponent(path.split('/').pop()!)
      if (method === 'DELETE') { removeTask(taskId); return done(envelope({ deleted: true, task_id: taskId })) }
      if (method === 'POST') { const task = makeTask(body); s.tasks.push(task); return done(envelope({ task }), 201) }
      const task = s.tasks.find((t: RecordData) => t.id === taskId)
      if (taskId && !task) return json({ message: '演示任务不存在。' }, 404)
      if (method === 'PATCH' || method === 'PUT') {
        if (!task) return json({ message: '请选择要修改的演示任务。' }, 400)
        Object.assign(task, body, { id: taskId })
        if (body.start !== undefined) task.start_at = body.start
        if (body.end_at !== undefined) task.end = body.end_at
        if (body.energy_demand !== undefined) task.energy_demand_source = 'user_confirmed'
        return done(envelope({ task }))
      }
      if (taskId) return json(envelope({ task, current_sessions: sessions().filter((x: RecordData) => x.task_id === taskId), history_sessions: [], interruption_episodes: [], plan_blocks: (s.active?.plan_patch || []).filter((b: RecordData) => b.task_id === taskId), plan: s.active }))
      return json(envelope({ tasks: s.tasks }))
    }
    if (path === '/api/plans/proposed') return json(envelope({ plan: s.proposed }))
    if (path === '/api/plans/active') return json(envelope({ plan: s.active }))
    if (path === '/api/plans/adjust-task') {
      const task = s.tasks.find((t: RecordData) => t.id === body.task_id)
      if (!task) return json({ message: '演示任务不存在。' }, 404)
      if (body.start_at && body.end_at && Date.parse(body.end_at) <= Date.parse(body.start_at)) return json({ message: '结束必须晚于开始。' }, 422)
      Object.assign(task, body.task_patch || {})
      if (task.task_type === 'fixed_event') { task.start_at = body.start_at || task.start_at; task.end = body.end_at || task.end }
      let changed = false
      for (const block of s.active?.plan_patch || []) if (block.task_id === task.id) {
        block.title = task.title
        if (body.start_at && body.end_at) {
          const start = wallParts(new Date(body.start_at), s.profile.timezone), end = wallParts(new Date(body.end_at), s.profile.timezone)
          Object.assign(block, { start_at: body.start_at, end_at: body.end_at, start: start.hour, end: end.hour, day_index: Math.round((Date.parse(start.date) - Date.parse(s.profile.active_week_id)) / 86400000) })
          changed = true
        }
      }
      if (changed) s.active.plan_revision++
      return done(envelope({ revision_created: changed, plan: s.active, execution_sessions: sessions() }))
    }
    if (path === '/api/plans/revise') {
      if (!s.active || body.plan_id !== s.active.plan_id) return json({ message: '演示计划已变化。' }, 409)
      s.proposed = { ...copy(s.active), plan_id: id(), plan_revision: s.active.plan_revision + 1, plan_status: 'proposed', edit_episode_id: id() }
      return done(envelope({ plan: s.proposed }))
    }
    if (path === '/api/plan-edits/events') { s.edits = [...(s.edits || []), body]; return done({ event: { ...body, id: id() } }) }
    if (path === '/api/plans/reject') { s.proposed = null; feedback.rejectProposal(); return done({ rejected: true }) }
    if (path === '/api/schedules/decide') {
      let job = Object.values(s.jobs).find((j: any) => body.request_id && j.request_id === body.request_id) as RecordData | undefined
      if (!job) { s.proposed = makePlan(); job = { job_id: id(), request_id: body.request_id, status: 'completed', result: copy(s.proposed) }; s.jobs[job.job_id] = job }
      return done({ job }, 202)
    }
    if (path === '/api/background-jobs') {
      const job = s.jobs[url.searchParams.get('job_id') || '']
      return job ? json({ job }) : json({ message: '演示生成任务不存在。' }, 404)
    }
    if (path === '/api/schedules/validate') return json({ validation: validation(body) })
    if (path === '/api/schedules/confirm') {
      if (!s.proposed || body.plan_id !== s.proposed.plan_id || (body.plan_revision !== undefined && body.plan_revision !== s.proposed.plan_revision) || ('expected_state_id' in body && body.expected_state_id !== s.state.id)) return json({ message: '演示草案或状态已变化，请重新生成。' }, 409)
      if (!validation(body).valid) return json({ message: '演示计划时间范围无效。' }, 422)
      s.active = { ...copy(s.proposed), ...copy(body), plan_status: 'confirmed', requires_confirmation: false }; s.proposed = null
      feedback.confirmProposal(s.active)
      for (const t of s.tasks) if (s.active.plan_patch.some((b: RecordData) => b.task_id === t.id)) t.status = 'scheduled'
      return done({ plan: s.active })
    }
    if (path === '/api/execution-sessions') return json(envelope({ execution_sessions: sessions() }))
    if (path === '/api/pending-work' && method === 'GET') return json(envelope({ pending_work: s.interaction?.candidates || [] }))
    if (path === '/api/execution-sessions/current') return json(envelope({ execution_session: null }))
    if (path === '/api/calendar/events') {
      const events: RecordData[] = s.tasks.filter((t: RecordData) => t.task_type === 'fixed_event').map((t: RecordData) => ({ id: t.id, title: t.title, start: t.start_at, end: t.end, extendedProps: { taskId: t.id, taskType: t.task_type, status: t.status } }))
      if (s.interaction?.fixture_loaded) events.push(...s.interaction.breaks)
      else for (let day = 0; day < 7; day++) events.push({ id: `demo-break-${day}`, title: '休息 · 散步', start: time(day, 10), end: time(day, 10.25), editable: false, extendedProps: { taskType: 'flexible_activity', status: 'scheduled' } })
      for (const block of s.active?.plan_patch || []) {
        if (s.interaction?.session_status?.[`session-${block.block_id}`] === 'deferred') continue
        const task = s.tasks.find((t: RecordData) => t.id === block.task_id)
        events.push({ id: block.block_id, title: task?.title || block.title, start: block.start_at || time(block.day_index, block.start), end: block.end_at || time(block.day_index, block.end), extendedProps: { taskId: block.task_id, blockId: block.block_id, executionSessionId: `session-${block.block_id}`, planRevision: s.active.plan_revision, status: s.interaction?.session_status?.[`session-${block.block_id}`] || 'scheduled', priority: task?.priority, taskType: task?.task_type, expectedDifficulty: task?.expected_difficulty, duration: task?.duration, context: task?.context, deadline_at: task?.deadline_at } })
      }
      return json(envelope({ events: events.filter(e => (!url.searchParams.get('start') || Date.parse(e.end) > Date.parse(url.searchParams.get('start')!)) && (!url.searchParams.get('end') || Date.parse(e.start) < Date.parse(url.searchParams.get('end')!))) }))
    }
    if (path === '/api/task-drafts') return json({ drafts: [] })
    if (path === '/api/chat/turns' || path === '/api/chat/history') return json(envelope({ turns: [], messages: [] }))
    if (path === '/api/behavior-patterns' && method === 'GET') return json(envelope({ patterns: [], processing_count: 0, failed_count: 0 }))
    // Fail closed: an unimplemented preview operation must never reach a real service.
    return json({ error: 'demo_operation_unavailable', message: '此操作尚未提供演示数据；没有连接真实服务。' }, 501)
  }
}
