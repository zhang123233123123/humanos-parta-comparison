'use client'
import { taskDateInstant } from '@/lib/task-fields'
import { apiResponseError } from '@/lib/client/api'
import { restorePlanningInputs } from '@/lib/onboarding-edit-draft'
import type { HumanOSTask } from '@/lib/contracts/task-contracts'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { StateFields } from '@/components/workspace-runtime/state-fields'
import { useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { emptyState, type StateValues } from '@/lib/interaction/contracts'
import { validState } from '@/lib/interaction/core'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ProcessingNotice } from '@/components/page-feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { setupTimezone } from '@/lib/setup-timezone'
import { DurationInput } from '@/components/ui/duration-input'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { TaskArrangementPreferences } from '@/components/task-arrangement-preferences'
import { useTranslation } from '@/i18n/LanguageProvider'
import { WeeklyAvailabilityPicker } from '@/components/weekly-availability-picker'
import { OnboardingActivities } from '@/components/onboarding-activities'
import { type ActivityDraft, type PlanningDates, restoreActivity, validateActivity, collectActivityTask, shiftDate } from '@/lib/onboarding-activities'

type TaskDraft = { context?: string; task_type: string; start_at: string; originalDependency?: string | null; loadedDependency?: string; persistedId?: string; originalDue?: string | null; loadedDue?: string; id: string; title: string; deadline_at: string; duration: number | string; priority: string; expected_difficulty: number | null; dependency: string }

const DRAFT_PREFIX = 'humanos:onboarding-draft:v3:'
const STEPS = ['context', 'rhythm', 'week', 'tasks'] as const

function stableId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}_${uuid || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`
}

function initialTask(): TaskDraft {
  return { id: stableId('task'), title: '', context: '', task_type: 'flexible_task', start_at: '', deadline_at: '', duration: '', priority: 'medium', expected_difficulty: null, dependency: '' }
}

export default function OnboardingPage() {
  const { data: session } = useSession()
  return session?.user?.id ? <AccountOnboarding key={session.user.id} accountId={session.user.id} /> : null
}
function AccountOnboarding({ accountId }: { accountId: string }) {
  const ORIGINAL_STORAGE_KEY = DRAFT_PREFIX + encodeURIComponent(accountId)
  const EDIT_STORAGE_KEY = `${ORIGINAL_STORAGE_KEY}:edit`
  const [editMode, setEditMode] = useState(false)
  const [leavingEdit, setLeavingEdit] = useState(false)
  const STORAGE_KEY = editMode ? EDIT_STORAGE_KEY : ORIGINAL_STORAGE_KEY
  const JOB_KEY = `humanos:onboarding-job:${encodeURIComponent(accountId)}`
  const [jobId, setJobId] = useState('')
  const [generationError, setGenerationError] = useState('')
  const runtime = useWorkspaceRuntime()
  const [preview, setPreview] = useState(false)
  const [publishedPlanId, setPublishedPlanId] = useState('')
  const [stateRequestId, setStateRequestId] = useState(() => stableId('onboarding-state'))
  const [stateSaved, setStateSaved] = useState('')

  const { t, locale } = useTranslation()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [restored, setRestored] = useState(false)
  const [timezone, setTimezone] = useState<string | undefined>()
  const [role, setRole] = useState('research_student')
  const [learningMode, setLearningMode] = useState('reading_writing')
  const [failureReasons, setFailureReasons] = useState<string[]>([])
  const [recentFailure, setRecentFailure] = useState('')
  const [sessionMinutes, setSessionMinutes] = useState(45)
  const [breakMinutes, setBreakMinutes] = useState(10)
  const [arrangement, setArrangement] = useState<{ task_switching_preference: string | null; task_distribution_preference: string | null }>({ task_switching_preference: null, task_distribution_preference: null })
  const [dayEnergy, setDayEnergy] = useState({ morning: 5, afternoon: 4, evening: 3 })
  const [availableWindows, setAvailableWindows] = useState('Monday-Sunday 08:00-21:00')
  const [contextItems, setContextItems] = useState<ActivityDraft[]>([])
  const [planningDates, setPlanningDates] = useState<PlanningDates | null>(null)
  const [showActivityErrors, setShowActivityErrors] = useState(false)
  const activityPeriod = planningDates ? { ...planningDates, today: runtime?.snapshot?.gate.local_date || planningDates.today } : null
  const [keepBuffer, setKeepBuffer] = useState(true)
  const [weeklyGoal, setWeeklyGoal] = useState('')
  const [tasks, setTasks] = useState<TaskDraft[]>([initialTask()])
  const [momentary, setMomentary] = useState<StateValues>(emptyState)
  const [editProfile, setEditProfile] = useState<Record<string, any> | null>(null)
  const [preservedTasks, setPreservedTasks] = useState<HumanOSTask[]>([])

  const draft = useMemo(() => ({ timezone, preview, publishedPlanId, stateRequestId, stateSaved, state_input_version: 2, difficulty_input_version: 1, step, role, learningMode, failureReasons, recentFailure, sessionMinutes, breakMinutes, arrangement, dayEnergy, availableWindows, contextItems, keepBuffer, weeklyGoal, tasks, momentary }), [timezone, preview, publishedPlanId, stateRequestId, stateSaved, step, role, learningMode, failureReasons, recentFailure, sessionMinutes, breakMinutes, arrangement, dayEnergy, availableWindows, contextItems, keepBuffer, weeklyGoal, tasks, momentary])

  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      try {
        const editing = new URLSearchParams(window.location.search).has('edit')
        setEditMode(editing)
        setJobId(editing ? '' : localStorage.getItem(JOB_KEY) || '')
        const editDraft = editing ? JSON.parse(localStorage.getItem(EDIT_STORAGE_KEY) || 'null') : null
        let saved = editDraft || JSON.parse(localStorage.getItem(ORIGINAL_STORAGE_KEY) || 'null')
        const [profileResponse, dateResponse] = await Promise.all([
          fetch('/api/profile', { cache: 'no-store' }),
          fetch('/api/state-checkins', { cache: 'no-store' }),
        ])
        if (!profileResponse.ok || !dateResponse.ok) throw new Error('无法读取账号日期和当前规划期，请刷新重试。')
        let profile = (await profileResponse.json()).data?.profile
        let gate = await dateResponse.json()
        if (!profile) throw new Error('无法读取个人资料，请重试。')
        const zone = setupTimezone(profile, saved, Intl.DateTimeFormat().resolvedOptions().timeZone, editing)
        if (zone !== profile.timezone) {
          const response = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: zone }) })
          if (!response.ok) throw new Error('无法保存当前时区，请重试。')
          profile = (await response.json()).data.profile
          const refreshedDate = await fetch('/api/state-checkins', { cache: 'no-store' })
          if (!refreshedDate.ok) throw new Error('无法读取当前日期，请重试。')
          gate = await refreshedDate.json()
          window.dispatchEvent(new Event('humanos:profile-updated'))
        }
        setTimezone(zone)
        const accountDate = gate.local_date
        const periodStart = profile?.active_week_id
        if (!periodStart || !accountDate) throw new Error('账号日期或规划期信息不完整，请刷新重试。')
        const period = { start: periodStart, end: shiftDate(periodStart, 6), today: accountDate }
        if (cancelled) return
        setPlanningDates(period)

        if (editing) {
          const response = await fetch('/api/tasks', { cache: 'no-store' })
          if (!response.ok) throw apiResponseError(response.status, await response.json().catch(() => ({})))
          const currentTasks = (await response.json()).data?.tasks
          if (!Array.isArray(currentTasks)) throw new Error(locale === 'zh' ? '无法读取当前任务，修改内容尚未保存。' : 'Cannot load current tasks. No edits have been saved.')
          if (cancelled) return
          const recovered = restorePlanningInputs(profile, currentTasks, gate.runtime_state || runtime?.snapshot?.state || null, saved)
          setEditProfile(profile)
          setPreservedTasks(recovered.preservedTasks)
          saved = editDraft || recovered.draft
        }

        // Explicit, account-scoped development import; never overwrite a browser draft.
        if (!editing && !saved && process.env.NODE_ENV === 'development'
          && new URLSearchParams(window.location.search).get('demoFixture') === 'humanos-demo-profile-v1') {
          const response = await fetch('/api/dev/demo-onboarding', { cache: 'no-store' })
          if (!response.ok) throw new Error('Test fixture could not be restored. Sign in with the dedicated test account.')
          saved = (await response.json()).draft
        }
        if (!editing && !saved && process.env.NODE_ENV === 'development') {
          const response = await fetch('/api/dev/onboarding-prefill', { cache: 'no-store' })
          if (!response.ok) {
            const error = await response.json().catch(() => ({}))
            throw new Error(error.message || '首次设置预填失败，请刷新后重试。')
          }
          saved = (await response.json()).draft
        }
        if (cancelled) return
        if (!saved && profile?.weekly_context?.context_items) setContextItems(profile.weekly_context.context_items.map((item: unknown) => restoreActivity(item, period)))
        if (saved) {
          setTimezone(editing ? profile.timezone : saved.timezone || zone)
          setPreview(saved.preview === true); setPublishedPlanId(saved.publishedPlanId || ''); setStateRequestId(saved.stateRequestId || stableId('onboarding-state')); setStateSaved(saved.stateSaved || '')
          setStep(Math.min(Number(saved.step) || 0, 3)); setRole(saved.role || role); setLearningMode(saved.learningMode || learningMode)
          setFailureReasons(saved.failureReasons || []); setRecentFailure(saved.recentFailure || '')
          setSessionMinutes(Number(saved.sessionMinutes) || 45); setBreakMinutes(saved.breakMinutes == null ? 10 : Number(saved.breakMinutes))
          setArrangement({ task_switching_preference: ['finish_then_switch', 'interleave'].includes(saved.arrangement?.task_switching_preference) ? saved.arrangement.task_switching_preference : null, task_distribution_preference: ['concentrated', 'spread'].includes(saved.arrangement?.task_distribution_preference) ? saved.arrangement.task_distribution_preference : null })
          setDayEnergy(saved.dayEnergy || dayEnergy); setAvailableWindows(saved.availableWindows || availableWindows)
          setContextItems((saved.contextItems || []).map((item: unknown) => restoreActivity(item, period))); setKeepBuffer(saved.keepBuffer !== false); setWeeklyGoal(saved.weeklyGoal || '')
          // Older drafts cannot distinguish an untouched default 5 from a reported 5.
          setTasks(saved.tasks?.length ? saved.tasks.map((task: TaskDraft) => ({
            ...task,
            expected_difficulty: saved.difficulty_input_version === 1 || task.expected_difficulty !== 5
              ? task.expected_difficulty ?? null : null,
          })) : [initialTask()]); setMomentary(saved.state_input_version === 2 ? (saved.momentary || emptyState()) : emptyState())
        }
      } catch (error) {
        if (!cancelled) { const message = error instanceof Error ? error.message : 'Could not restore setup draft.'; setGenerationError(message); toast.error(message) }
        return
      }
      if (!cancelled) setRestored(true)
    }
    void restore()
    return () => { cancelled = true }
    // Initial restoration intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (restored && !leavingEdit) localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
  }, [draft, restored, leavingEdit, STORAGE_KEY])

  function cancelEdit() {
    setLeavingEdit(true)
    localStorage.removeItem(EDIT_STORAGE_KEY)
    router.replace('/app')
  }

  const patchTask = (id: string, patch: Partial<TaskDraft>) => setTasks((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  const toggleFailure = (value: string) => setFailureReasons((items) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value])

  useEffect(() => {
    if (!restored || new URLSearchParams(window.location.search).has('edit')) return
    const resume = async () => {
      const response = await fetch('/api/profile', { cache: 'no-store' })
      if (!response.ok) return
      const profile = (await response.json()).data?.profile
      const proposed = await fetch('/api/plans/proposed', { cache: 'no-store' })
      const savedPlan = proposed.ok ? (await proposed.json()).data?.plan : null
      if (profile?.research_context?.onboarding_submitted || jobId || preview || publishedPlanId || (profile?.research_context?.onboarding_step === 3 && savedPlan?.plan_id)) {
        if (!profile?.research_context?.onboarding_submitted) {
          const saved = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ research_context: { ...profile.research_context, onboarding_submitted: true } }) })
          if (!saved.ok) throw new Error('Cannot resume setup. Retry.')
        }
        await runtime?.refresh()
        router.replace('/app')
      }
    }
    void resume().catch(e => setGenerationError(e.message))
  }, [restored, jobId, preview, publishedPlanId, router])

  async function saveProgress(nextStep: number) {
    if (step === 1 && (!Number.isFinite(sessionMinutes) || sessionMinutes <= 0 || !Number.isFinite(breakMinutes) || breakMinutes < 0)) { toast.error(locale === 'zh' ? '请填写有效工作上限与休息时长。' : 'Enter valid work and break limits.'); return }
    if (step === 2) setShowActivityErrors(true)
    if (step === 2 && (!availableWindows.trim() || invalidContextItem())) { toast.error(locale === 'zh' ? '请补全本页可用时间与活动。' : 'Complete this page’s availability and activities.'); return }
    // In edit mode, intermediate steps are an unsaved local draft.
    // Only the explicit final action uses the existing save/generate flow.
    if (editMode) { setStep(nextStep); return }
    setLoading(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profilePayload(nextStep)),
      })
      if (!response.ok) throw new Error(t('onboarding.saveFailed'))
      setStep(nextStep)
    } catch (error) { const message = error instanceof Error ? error.message : t('onboarding.saveFailed'); setGenerationError(message); toast.error(message) }
    finally { setLoading(false) }
  }

  function profilePayload(currentStep = step) {
    return {
      ...(timezone ? { timezone } : {}),
      role,
      blocker_patterns: failureReasons,
      task_preferences: { ...(editMode ? editProfile?.task_preferences : {}), ...arrangement, learning_mode: learningMode, preferred_session_minutes: sessionMinutes, rest_between_tasks_minutes: breakMinutes, typical_energy: dayEnergy },
      research_context: { ...(editMode ? editProfile?.research_context : {}), planning_failure_reasons: failureReasons, recent_plan_failure: recentFailure, onboarding_step: currentStep, onboarding_completed: false },
    }
  }

  function invalidContextItem() { return !activityPeriod || contextItems.some(item => !validateActivity(item, activityPeriod).valid) }


  async function finish() {
    if (jobId || loading) return
    setGenerationError('')
    const readyTasks = tasks.filter((task) => task.title.trim())
    if (!readyTasks.length || readyTasks.some(task => !Number.isFinite(Number(task.duration)) || Number(task.duration) <= 0)) { toast.error(locale === 'zh' ? '请至少填写一个任务与有效时长。' : 'Enter at least one task and a valid duration.'); return }
    if (readyTasks.some(task => task.task_type && task.task_type !== 'flexible_task')) { toast.error(locale === 'zh' ? '旧草稿中包含其他类型的事项。请将活动录入第 3 页，并移除本页对应的旧条目后再提交。' : 'This draft contains another kind of item. Enter activities on page 3 and remove their old entries here before submitting.'); return }
    if (readyTasks.some(task => !Number.isInteger(Number(task.duration)) || Number(task.duration) > 1440)) { toast.error(locale === 'zh' ? '请填写 1–1440 的整数工作分钟。' : 'Enter 1–1440 whole minutes of work.'); return }
    if (readyTasks.some(task => !task.deadline_at?.trim())) { toast.error(locale === 'zh' ? '请填写普通任务的截止时间。' : 'Enter a deadline for each task.'); return }
    if (readyTasks.some(task => task.expected_difficulty != null && (!Number.isInteger(task.expected_difficulty) || task.expected_difficulty < 1 || task.expected_difficulty > 10))) { toast.error(locale === 'zh' ? '难度请填写 1–10 的整数，或留空。' : 'Enter a whole number from 1 to 10, or leave difficulty empty.'); return }
    if (!validState(momentary)) { toast.error(locale === 'zh' ? '请选择当前心情，并分别填写精力、专注、压力。' : 'Select your mood and report energy, focus and stress.'); return }
    if (!availableWindows.trim() || !weeklyGoal.trim()) {
      toast.error(t('onboarding.requiredError')); return
    }
    if (invalidContextItem()) {
      setShowActivityErrors(true); setStep(2)
      toast.error(locale === 'zh' ? '请修正活动表单中标出的错误，其他填写内容已保留。' : 'Correct the marked activity fields. Other input has been kept.')
      return
    }
    setLoading(true)
    try {
      const profileResponse = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profilePayload(3)) })
      if (!profileResponse.ok) throw new Error(t('onboarding.saveFailed'))

      const weekResponse = await fetch('/api/weekly-setup/reconcile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { ...profilePayload(3), weekly_context: { weekly_goal: weeklyGoal, weekly_available_windows: availableWindows, context_items: [], keep_buffer: keepBuffer } },
          tasks: [...readyTasks.map((task) => ({
            ...(task.persistedId ? { id: task.persistedId } : {}),
            title: task.title.trim(),
            // Page 4 owns to-do work; this is an API compatibility value, not an activity choice.
            task_type: 'flexible_task',
            start_at: null,
            deadline_at: task.persistedId && task.deadline_at === task.loadedDue ? task.originalDue ?? null : taskDateInstant(task.deadline_at.trim(), timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),
            duration: Number(task.duration),
            priority: task.priority,
            ...(task.context !== undefined ? { context: task.context } : {}),
            expected_difficulty: task.expected_difficulty,
            dependency: task.persistedId && task.dependency === task.loadedDependency ? task.originalDependency ?? null : task.dependency.trim(),
            request_id: task.id,
            ...(!task.persistedId ? { status: 'queued' } : {}),
          })), ...contextItems.map(item => collectActivityTask(item, activityPeriod!, timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)), ...(editMode ? preservedTasks : [])],
        }),
      })
      if (!weekResponse.ok) {
        const error = await weekResponse.json().catch(() => ({})) as { message?: string; error?: string }
        throw apiResponseError(weekResponse.status, error)
      }

      if (!runtime) throw new Error(t('onboarding.stateFailed'))
      const gateResponse = await fetch('/api/state-checkins', { cache: 'no-store' })
      if (!gateResponse.ok) throw new Error(t('onboarding.stateFailed'))
      const gate = await gateResponse.json()
      if (stateSaved !== JSON.stringify(momentary) || gate.required || !(['mood', 'energy', 'focus', 'stress', 'daily_note'] as const).every(key => gate.runtime_state?.[key] === momentary[key])) {
        // Shared service sends source:onboarding AND daily_checkin:true, caches only acknowledged values.
        const requestId = stateSaved ? stableId('onboarding-state') : stateRequestId
        setStateRequestId(requestId)
        await runtime.service.saveState(momentary, requestId, 'onboarding')
        const signature = JSON.stringify(momentary); setStateSaved(signature)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, stateSaved: signature }))
        await runtime.refresh()
      }

      const generationRequestId = stableId('initial-plan')
      const submitted = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ research_context: { ...profilePayload(3).research_context, onboarding_submitted: true, initial_plan_request_id: generationRequestId } }) })
      if (!submitted.ok) throw new Error(t('onboarding.saveFailed'))
      localStorage.removeItem(JOB_KEY)
      await runtime.refresh()
      if (editMode) {
        setLeavingEdit(true)
        localStorage.setItem(ORIGINAL_STORAGE_KEY, JSON.stringify({ ...draft, stateSaved: JSON.stringify(momentary) }))
        localStorage.removeItem(EDIT_STORAGE_KEY)
      }
      router.replace('/app')
    } catch (error) { const message = error instanceof Error ? error.message : t('onboarding.saveFailed'); setGenerationError(message); toast.error(message) }
    finally { setLoading(false) }
  }


  return <main className="humanos-onboarding h-full min-h-0 overflow-y-auto overscroll-contain p-4 pb-12 md:p-10 md:pb-16">
    <Card className="mx-auto max-w-4xl overflow-hidden border-border bg-card text-foreground shadow-none">
      <CardHeader className="border-b p-6 md:px-10 md:pt-9">
        <div className="flex items-start justify-between gap-4"><div><CardTitle className="text-xl font-semibold tracking-tight">{!restored && !editMode ? (locale === 'zh' ? '正在读取计划资料…' : 'Loading planning inputs…') : editMode ? (locale === 'zh' ? '修改计划依据' : 'Edit planning inputs') : t('onboarding.title')}</CardTitle><p className="mt-2 text-sm text-muted-foreground">{!restored && !editMode ? '' : editMode ? (locale === 'zh' ? '调整任务、截止时间或工作偏好；保存后将重新生成候选计划。' : 'Adjust tasks, deadlines or work preferences; saving will regenerate the candidate plan.') : t('onboarding.subtitle')}</p></div><Badge variant="secondary">{t(`onboarding.step${step + 1}of`)}</Badge></div>
        <ol className="humanos-onboarding-progress mt-6 grid grid-cols-4 gap-3 text-xs text-muted-foreground" aria-label={locale === 'zh' ? '设置进度' : 'Setup progress'}>{STEPS.map((item, index) => <li key={item} data-complete={index <= step} aria-current={index === step ? 'step' : undefined}><span className="mr-1.5 tabular-nums">{index + 1}.</span>{(locale === 'zh' ? ['了解你', '工作节奏', '可用时间', '任务与状态'] : ['About you', 'Work rhythm', 'Availability', 'Tasks & state'])[index]}</li>)}</ol>
      </CardHeader>
      <CardContent className="p-6 md:p-10">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{editMode && step === 2 ? (locale === 'zh' ? '本次规划期安排' : 'Current planning period') : t(`onboarding.step${step + 1}Title`)}</h2><p className="mt-1 text-sm text-muted-foreground">{editMode && step === 3 ? (locale === 'zh' ? '检查任务和当前状态；保存后回到日历查看新的候选计划，再由你确认。' : 'Review tasks and your current state; after saving, review the new candidate on the calendar before confirming it.') : t(`onboarding.step${step + 1}Desc`)}</p>

        {step === 0 && <div className="mx-auto mt-6 grid max-w-3xl gap-6">
          <ChoiceGroup name="learning-context" label={t('onboarding.roleLabel')} value={role} onChange={setRole} options={['research_student','coursework_student','thesis_stage','project_stage'].map((value,index) => ({ value, label: t(`onboarding.role${['Graduate','Coursework','Thesis','Project'][index]}`) }))} />
          <ChoiceGroup name="learning-mode" label={t('onboarding.learningModeLabel')} value={learningMode} onChange={setLearningMode} options={['reading_writing','visual','discussion','practice','mixed'].map((value,index) => ({ value, label: t(`onboarding.mode${['Reading','Visual','Discussion','Practice','Mixed'][index]}`) }))} />
          <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium text-foreground">{t('onboarding.blockersLabel')}<span className="ml-2 font-normal text-muted-foreground">{locale === 'zh' ? '可多选' : 'Select all that apply'}</span></legend><div className="grid grid-cols-2 gap-3">{['task_ambiguity','fatigue','interruption','context_loss','underduration','priority_change'].map((value, index) => <label key={value} className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${failureReasons.includes(value) ? 'border-primary bg-primary/10' : 'bg-background'}`}><Checkbox checked={failureReasons.includes(value)} onCheckedChange={() => toggleFailure(value)} />{t(`onboarding.blocker${['Ambiguity','Fatigue','Interruption','ContextLoss','Duration','Priority'][index]}`)}</label>)}</div></fieldset>
          <Field label={t('onboarding.planningGapLabel')}><textarea className="min-h-24 w-full rounded-xl border bg-background p-3 text-sm" value={recentFailure} onChange={(event) => setRecentFailure(event.target.value)} placeholder={t('onboarding.planningGapPlaceholder')} /></Field>
        </div>}

        {step === 1 && <div className="mx-auto mt-6 grid max-w-3xl gap-6">
          <section className="grid gap-3" aria-labelledby="rhythm-arrangement"><h3 id="rhythm-arrangement" className="font-medium">{locale === 'zh' ? '任务安排偏好' : 'Task arrangement preferences'}</h3><TaskArrangementPreferences columns locale={locale} values={arrangement} onChange={(key, value) => setArrangement(current => ({ ...current, [key]: value }))} /></section>
          <section className="grid gap-3 border-t pt-6" aria-labelledby="rhythm-focus"><h3 id="rhythm-focus" className="font-medium">{locale === 'zh' ? '专注与休息' : 'Focus and breaks'}</h3><div className="grid items-start gap-4 sm:grid-cols-2">
            <Field label={t('onboarding.sessionLengthLabel')}><NumberChoices locale={locale} value={sessionMinutes} values={[25,45,60,90]} onChange={setSessionMinutes} /></Field>
            <Field label={t('onboarding.breakLengthLabel')}><NumberChoices locale={locale} value={breakMinutes} values={[5,10,15,20]} onChange={setBreakMinutes} /></Field>
          </div></section>
          <section className="grid gap-3 border-t pt-6" aria-labelledby="rhythm-energy"><h3 id="rhythm-energy" className="font-medium">{locale === 'zh' ? '一天中的典型精力' : 'Typical energy throughout the day'}</h3><div className="grid items-start gap-4 md:grid-cols-3">
            {(['morning','afternoon','evening'] as const).map((period) => <Field key={period} label={t(`onboarding.${period}Energy`)}><div className="grid w-full gap-2"><div className="flex items-center gap-3"><input aria-label={t(`onboarding.${period}Energy`)} type="range" min="1" max="7" value={dayEnergy[period]} onChange={(e) => setDayEnergy({ ...dayEnergy, [period]: Number(e.target.value) })} className="min-w-0 flex-1" /><span className="shrink-0 text-sm font-medium">{dayEnergy[period]}/7</span></div><div className="flex justify-between text-xs text-muted-foreground"><span>{locale === 'zh' ? '低' : 'Low'}</span><span>{locale === 'zh' ? '高' : 'High'}</span></div></div></Field>)}
          </div></section>
        </div>}

        {step === 2 && <div className="mt-7 grid gap-6">
          <section aria-labelledby="availability-heading"><h3 id="availability-heading" className="mb-3 text-sm font-medium">{t('onboarding.windowsLabel')}</h3><WeeklyAvailabilityPicker value={availableWindows} onChange={setAvailableWindows} /></section>
          <OnboardingActivities items={contextItems} onChange={setContextItems} period={activityPeriod} showErrors={showActivityErrors} disabled={loading} />
          <label className="flex items-center gap-3 rounded-xl border p-4 text-sm"><Checkbox checked={keepBuffer} onCheckedChange={(checked) => setKeepBuffer(checked === true)} /><span><strong>{t('onboarding.bufferLabel')}</strong><span className="block text-muted-foreground">{t('onboarding.bufferHint')}</span></span></label>
        </div>}

        {step === 3 && <div className="mx-auto mt-6 grid max-w-3xl gap-6">
          <Field label={t('onboarding.goalLabel')}><textarea className="min-h-20 w-full rounded-xl border bg-background p-3 text-sm" value={weeklyGoal} onChange={(e) => setWeeklyGoal(e.target.value)} /></Field>
          <div className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-medium">{locale === 'zh' ? '本周想推进的任务' : 'Tasks to work on this week'}</h3><p className="mt-1 text-xs text-muted-foreground">{locale === 'zh' ? '这里填写本周想推进的任务，截止日期可以在下周或更晚；系统会结合截止紧迫性安排。活动请在第 3 页填写。' : 'Choose work to advance this week, even if its deadline is later. Deadline urgency helps determine its order. Enter activities on page 3.'}</p></div><Button variant="outline" size="sm" onClick={() => setTasks([...tasks, initialTask()])}><Plus className="mr-1 h-4 w-4" />{t('onboarding.addTask')}</Button></div>{tasks.map((task, index) => <div key={task.id} className="rounded-lg border bg-background p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('onboarding.taskNumber').replace('{number}', String(index + 1))}</span><Button size="icon" variant="ghost" aria-label={locale === 'zh' ? `删除任务 ${index + 1}` : `Remove task ${index + 1}`} className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={loading} onClick={() => setTasks((items) => items.filter((entry) => entry.id !== task.id))}><Trash2 className="h-4 w-4" /></Button></div>
            {task.task_type && task.task_type !== 'flexible_task' && <p role="alert" className="mb-3 text-sm text-destructive">{locale === 'zh' ? '这是旧草稿中的其他类型事项，请先在第 3 页录入活动，再移除本条目。' : 'This is another kind of item from an older draft. Enter the activity on page 3, then remove this entry.'}</p>}
            <div className="grid gap-4">
              <div className="grid items-start gap-4 sm:grid-cols-5">
                <div className="min-w-0 sm:col-span-3"><Field label={t('onboarding.taskName')}><Input value={task.title} onChange={(e) => patchTask(task.id, { title: e.target.value })} /></Field></div>
                <div className="min-w-0 sm:col-span-2"><Field label={t('onboarding.deadline')}><DateTimePicker className="min-w-0" pickerLabel={locale === 'zh' ? '选择日期' : 'Choose date'} ariaLabel={t('onboarding.deadline')} value={task.deadline_at} onChange={(value) => patchTask(task.id, { deadline_at: value })} /></Field></div>
              </div>
              <div className="grid items-start gap-4 sm:grid-cols-3">
                <Field label={t('onboarding.totalWork')} hint={t('onboarding.totalWorkHint')}><DurationInput value={task.duration} onValueChange={value => patchTask(task.id, { duration: value })} maxMinutes={1440} zh={locale === 'zh'} /></Field>
                <Field label={t('onboarding.priority')}><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={task.priority} onChange={(e) => patchTask(task.id, { priority: e.target.value })}><option value="high">{t('taskDialog.priorityHigh')}</option><option value="medium">{t('taskDialog.priorityMedium')}</option><option value="low">{t('taskDialog.priorityLow')}</option></select></Field>
                <Field label={t('onboarding.difficulty')} hint={t('onboarding.difficultyHint')}><Input type="number" min="1" max="10" value={task.expected_difficulty ?? ''} placeholder={t('checkin.notReported')} onChange={(e) => patchTask(task.id, { expected_difficulty: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
              </div>
              <Field label={t('onboarding.dependency')}><Input value={task.dependency} onChange={(e) => patchTask(task.id, { dependency: e.target.value })} /></Field>
              <Field label={locale === 'zh' ? '任务说明（可选）' : 'Brief description (optional)'}><textarea className="min-h-20 w-full rounded-xl border bg-background p-3 text-sm" value={task.context ?? ''} onChange={(e) => patchTask(task.id, { context: e.target.value })} /></Field>
            </div>
          </div>)}</div>
          <div className="rounded-xl border p-4"><StateFields value={momentary} onChange={value => { setMomentary(value); setStateSaved(''); setStateRequestId(stableId('onboarding-state')) }} /></div>
        </div>}

        {(loading || jobId) && <div className="mt-6"><ProcessingNotice label={jobId ? (locale === 'zh' ? '正在生成计划，可能需要几分钟。完成后会显示预览供你确认；刷新页面也会继续等待，请勿重复提交。' : 'Generating your plan. This may take several minutes. You can review it before confirming; refreshing resumes the same request.') : (locale === 'zh' ? '正在保存资料并准备生成计划，请稍候…' : 'Saving your inputs and preparing the plan…')} /></div>}
        {generationError && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{generationError}</p>}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <div className="flex items-center gap-2"><Button variant="outline" disabled={step === 0 || loading || Boolean(jobId) || !restored} onClick={() => setStep(step - 1)}>{t('onboarding.back')}</Button>{editMode && <Button variant="ghost" disabled={loading} onClick={cancelEdit}>{locale === 'zh' ? '取消修改' : 'Cancel changes'}</Button>}</div>
          {step < 3 ? <Button disabled={loading || Boolean(jobId) || !restored} onClick={() => saveProgress(step + 1)}>{loading ? t('onboarding.saving') : t('onboarding.next')}</Button> : <Button disabled={loading || Boolean(jobId) || !restored} onClick={finish}>{loading || jobId ? t('onboarding.buildingPlan') : editMode ? (locale === 'zh' ? '保存并重新生成计划' : 'Save and regenerate plan') : (locale === 'zh' ? '生成我的计划' : 'Generate my plan')}</Button>}
        </div>
      </CardContent>
    </Card>
  </main>
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) { return <label className="flex min-w-0 flex-col items-stretch gap-2 self-start text-sm font-medium text-foreground"><span>{label}</span><div className="min-w-0 font-normal text-foreground">{children}</div>{hint && <span className="text-xs font-normal leading-5 text-muted-foreground">{hint}</span>}</label> }
function NumberChoices({ value, values, onChange, locale }: { value: number; values: number[]; onChange: (value: number) => void; locale: string }) { return <div className="flex flex-wrap gap-2">{values.map((item) => <button type="button" key={item} aria-pressed={value === item} onClick={() => onChange(item)} className={`rounded-lg border px-2.5 py-2 text-sm ${value === item ? 'border-primary bg-primary/10 text-primary' : 'bg-background'}`}>{item} {locale === 'zh' ? '分钟' : 'minutes'}</button>)}</div> }
function ChoiceGroup({ name, label, value, options, onChange }: { name: string; label: string; value: string; options: Array<{value: string; label: string}>; onChange: (value: string) => void }) {
  return <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium text-foreground">{label}</legend><div className="grid grid-cols-2 gap-3">{options.map(option => <label key={option.value} className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${value === option.value ? 'border-primary bg-primary/10 text-primary' : 'bg-background'}`}><input type="radio" className="shrink-0 accent-primary" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />{option.label}</label>)}</div></fieldset>
}
