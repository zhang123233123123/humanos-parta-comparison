'use client'
import { taskDateInput, taskDateInstant } from '@/lib/task-fields'
import { NextWeekPlanner } from '@/components/next-week-planner'
import { DecisionReasonMessage } from '@/components/decision-reason-message'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { localTime } from '@/lib/presentation/task'
import { useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { ArrowLeft, CalendarCheck, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DurationInput } from '@/components/ui/duration-input'
import { Input } from '@/components/ui/input'
import { apiRequest } from '@/lib/client/api'
import { currentScheduleResult } from '@/lib/client/current-schedule-result'
import type { HumanOSTask } from '@/lib/contracts/task-contracts'
import type { PlanBlock, PlanDecision, PlanResourceEnvelope, PlanValidation, WeekStatus } from '@/lib/contracts/planning-contracts'
import type { ResourceEnvelope } from '@/lib/contracts/api-contracts'
import { useTranslation } from '@/i18n/LanguageProvider'
import { toast } from 'sonner'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { WeeklyAvailabilityPicker } from '@/components/weekly-availability-picker'
import { ScheduleExplanation } from '@/components/schedule-explanation'
import { LoadingSkeleton, ProcessingNotice } from '@/components/page-feedback'

type Stage = 'setup' | 'review'

function blockDateTime(weekId: string, dayIndex: number, hour: number) {
  const date = new Date(`${weekId}T00:00:00`)
  date.setDate(date.getDate() + dayIndex)
  date.setMinutes(Math.round(hour * 60))
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 16)
}

// Legacy runtime-adjustment links must not invoke the weekly parent-task
// rescheduler. Explicit seven-day planning remains available without these args.
export default function WeeklyPlanPage() {
  const params = useSearchParams()
  return params.get('adjust') || params.get('job_id') ? <RuntimeAdjustmentBridge /> : <WeeklyPlanContent />
}
function RuntimeAdjustmentBridge() {
  const runtime = useWorkspaceRuntime()
  const router = useRouter()
  const opened = useRef(false)
  const { locale } = useTranslation()
  useEffect(() => {
    if (!runtime || opened.current) return
    opened.current = true
    runtime.open(runtime.outcome?.kind === 'adjust'
      ? { id: 'runtime-review', kind: 'review' }
      : { id: 'manual-state', kind: 'state', source: 'manual' })
    router.replace('/app')
  }, [runtime, router])
  return <p role="status" className="p-6 text-sm text-muted-foreground">{locale === 'zh' ? '返回今天的状态与调整入口…' : 'Returning to today’s state and adjustment flow…'}</p>
}
function WeeklyPlanContent() {
  const { t, locale } = useTranslation()
  const searchParams = useSearchParams()
  const adjustmentTrigger = searchParams.get('adjust') || ''
  const interruptionJobId = searchParams.get('job_id') || ''
  const dailyAdjustment = adjustmentTrigger === 'daily-checkin'
  const [stage, setStage] = useState<Stage>('setup')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [planningPhase, setPlanningPhase] = useState<'saving' | 'planning' | null>(null)
  const [weekStatus, setWeekStatus] = useState<WeekStatus | null>(null)
  const selectedTaskId = searchParams.get('task') || ''
  const [profile, setProfile] = useState<Record<string, any> | null>(null)
  const [tasks, setTasks] = useState<HumanOSTask[]>([])
  const [decision, setDecision] = useState<PlanDecision | null>(null)
  const [blocks, setBlocks] = useState<PlanBlock[]>([])
  const [validation, setValidation] = useState<PlanValidation | null>(null)
  const [rationaleRequired, setRationaleRequired] = useState(false)
  const [rationale, setRationale] = useState('')
  const [restAccepted, setRestAccepted] = useState(false)
  const restPolicy = (decision as any)?.replan_policy
  useEffect(() => setRestAccepted(false), [decision, blocks])
  const [carryIds, setCarryIds] = useState<string[]>([])
  const [rolloverMode, setRolloverMode] = useState<'use_last' | 'fresh'>('use_last')
  const [weeklyGoal, setWeeklyGoal] = useState('')
  const [availableWindows, setAvailableWindows] = useState('')
  const [temporaryConstraints, setTemporaryConstraints] = useState('')
  const [keepBuffer, setKeepBuffer] = useState(true)
  const editSnapshot = useRef('')
  const titleRequests = useRef(new Set<string>())
  const savedTitles = useRef<Record<string,string>>({})
  const [titleSave, setTitleSave] = useState<Record<string,string>>({})

  const weekId = weekStatus?.current_week_id || ''

  const loadPlanningState = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [status, profileData, taskData, planData, proposalData] = await Promise.all([
        apiRequest<WeekStatus>('/api/weeks/status'),
        apiRequest<ResourceEnvelope<{ profile: Record<string, any> }>>('/api/profile'),
        apiRequest<ResourceEnvelope<{ tasks: HumanOSTask[] }>>('/api/tasks'),
        apiRequest<PlanResourceEnvelope<{ plan: PlanDecision | null }>>('/api/plans/active'),
        apiRequest<PlanResourceEnvelope<{ plan: PlanDecision | null }>>('/api/plans/proposed'),
      ])
      const unfinishedIds = new Set((status.unfinished_task_ids || []).map(String))
      const unfinishedTasks = (taskData.data.tasks || []).filter((task) => unfinishedIds.has(String(task.id)))
      setWeekStatus(status)
      setProfile(profileData.data.profile)
      setTasks(unfinishedTasks)
      savedTitles.current = Object.fromEntries(unfinishedTasks.map(task => [String(task.id), task.title || '']))
      setCarryIds(unfinishedTasks.map((task) => String(task.id)))
      const weekly = profileData.data.profile?.weekly_context || {}
      setWeeklyGoal(String(weekly.weekly_goal || ''))
      setAvailableWindows(String(weekly.weekly_available_windows || ''))
      setTemporaryConstraints(
        Array.isArray(weekly.temporary_constraints)
          ? weekly.temporary_constraints.join('\n')
          : String(weekly.temporary_constraints || ''),
      )
      setKeepBuffer(weekly.keep_buffer !== false)
      if (interruptionJobId) {
        setDecision(null); setBlocks([]); setValidation(null)
        setPlanningPhase('planning')
        let job: { status: string; result?: PlanDecision; error?: string } = { status: 'queued' }
        for (let attempt = 0; attempt < 180; attempt += 1) {
          job = (await apiRequest<{ job: typeof job }>(`/api/background-jobs?job_id=${encodeURIComponent(interruptionJobId)}`)).job
          if (['completed', 'failed'].includes(job.status)) break
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        if (job.status !== 'completed' || !job.result || job.result.error || job.result.unavailable) {
          throw new Error(job.error || job.result?.error || t('planning.generateFailed'))
        }
        const current = await currentScheduleResult(job.result, status.current_week_id, locale)
        setDecision(current); setBlocks(current.plan_patch || []); setValidation(current.validation || null); setStage('review')
      } else if (proposalData.data.plan && !dailyAdjustment) {
        setDecision(proposalData.data.plan)
        setBlocks(proposalData.data.plan.plan_patch || [])
        setValidation(proposalData.data.plan.validation || null)
        setStage('review')
      } else {
        setDecision(null); setBlocks([]); setValidation(null); setStage('setup')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('planning.loadFailed')
      setLoadError(message)
      toast(message)
    } finally {
      setLoading(false)
      setPlanningPhase(null)
    }
  }, [t, dailyAdjustment, interruptionJobId, locale])

  useEffect(() => {
    void loadPlanningState()
  }, [loadPlanningState])

  const taskName = useMemo(
    () => new Map(tasks.map((task) => [String(task.id), task.title || t('planning.untitledTask')])),
    [tasks, t],
  )
  const localDiff = decision?.source === 'continue_later_local_diff' ? decision.calendar_diff : undefined

  const formatDateTime = (value?: string) => localTime(value, profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, locale)

  const updateTask = (index: number, field: string, value: string | number) => {
    setTasks((current) => current.map((task, taskIndex) => (
      taskIndex === index ? { ...task, [field]: value } : task
    )))
  }

  const saveTitle = async (task: HumanOSTask) => {
    const id = String(task.id), title = (task.title || '').trim()
    if (titleRequests.current.has(id) || title === savedTitles.current[id]) return
    if (!title) { setTitleSave(current => ({...current, [id]: 'empty'})); return }
    titleRequests.current.add(id)
    setTitleSave(current => ({...current, [id]: 'saving'}))
    try {
      await apiRequest('/api/tasks', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id, title})})
      savedTitles.current[id] = title
      setTasks(current => current.map(item => String(item.id) === id ? {...item, title} : item))
      setTitleSave(current => ({...current, [id]: 'saved'}))
      window.dispatchEvent(new Event('humanos:tasks-updated'))
    } catch {
      setTitleSave(current => ({...current, [id]: 'failed'}))
    } finally { titleRequests.current.delete(id) }
  }

  const deleteTask = async (task: HumanOSTask) => {
    if (!task.id || !window.confirm(locale === 'zh' ? `删除任务“${task.title}”？` : `Delete “${task.title}”?`)) return
    try {
      await apiRequest('/api/tasks', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_id: task.id }) })
      setTasks((current) => current.filter((item) => item.id !== task.id))
      setDecision(null); setValidation(null); setBlocks([]); setStage('setup')
      toast(locale === 'zh' ? '任务已删除，计划需要重新生成' : 'Task deleted. Regenerate the plan.')
    } catch (error) {
      toast(error instanceof Error ? error.message : (locale === 'zh' ? '删除失败' : 'Delete failed'))
    }
  }

  const saveSetup = useCallback(async () => {
    if (!profile || !weekId) return
    const weeklyContext = {
      ...(profile.weekly_context || {}),
      week_id: weekId,
      week_of: weekId,
      weekly_goal: weeklyGoal,
      weekly_available_windows: availableWindows,
      temporary_constraints: temporaryConstraints.split('\n').map((item) => item.trim()).filter(Boolean),
      keep_buffer: keepBuffer,
    }
    await apiRequest('/api/weekly-setup/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week_id: weekId,
        profile: { ...profile, weekly_context: weeklyContext },
        tasks: tasks.map((task) => ({
          id: task.id,
          title: savedTitles.current[String(task.id)] ?? task.title,
          task_type: task.task_type,
          start_at: taskDateInstant(task.start_at, profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),
          deadline_at: taskDateInstant(task.deadline_at, profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone),
          duration: Number(task.duration || 0),
          priority: task.priority || 'medium',
          context: task.context || '',
          context_window: task.contextWindow || {},
        })),
      }),
    })
  }, [availableWindows, keepBuffer, profile, tasks, temporaryConstraints, weekId, weeklyGoal])

  const generatePlan = useCallback(async () => {
    setSubmitting(true)
    setPlanningPhase(dailyAdjustment ? 'planning' : 'saving')
    try {
      if (!dailyAdjustment) await saveSetup()
      setPlanningPhase('planning')
      const accepted = await apiRequest<{ job: { job_id: string } }>('/api/schedules/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          week_id: weekId,
          client_now: new Date().toISOString(),
          adjustment_trigger: adjustmentTrigger || undefined,
          replan_scope: dailyAdjustment ? 'today' : undefined,
          rebuild_from_scratch: true,
        }),
      })
      let job: { status: string; result?: PlanDecision; error?: string } = { status: 'queued' }
      for (let attempt = 0; attempt < 180 && !['completed', 'failed'].includes(job.status); attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1000))
        job = (await apiRequest<{ job: typeof job }>(`/api/background-jobs?job_id=${encodeURIComponent(accepted.job.job_id)}`)).job
      }
      if (job.status !== 'completed' || !job.result) throw new Error(job.error || t('planning.generateFailed'))
      if (job.result.unavailable || job.result.error) {
        throw new Error(job.result.error || t('planning.aiUnavailable'))
      }
      const current = await currentScheduleResult(job.result, weekId, locale)
      setDecision(current)
      setBlocks(current.plan_patch)
      setValidation(current.validation || null)
      setStage('review')
    } catch (error) {
      // Never leave a historical/previous draft looking ready to confirm.
      setDecision(null)
      setBlocks([])
      setValidation(null)
      setRationaleRequired(false)
      setStage('setup')
      toast(error instanceof Error ? error.message : t('planning.generateFailed'))
    } finally {
      setSubmitting(false)
      setPlanningPhase(null)
    }
  }, [adjustmentTrigger, dailyAdjustment, saveSetup, t, weekId, locale])

  useEffect(() => {
    if (interruptionJobId || dailyAdjustment || loading || stage !== 'setup' || weekStatus?.new_week) return
    const snapshot = JSON.stringify({
      weeklyGoal, availableWindows, temporaryConstraints, keepBuffer,
      tasks: tasks.map((task) => ({ id: task.id, task_type: task.task_type,
          start_at: task.start_at,
          deadline_at: task.deadline_at, duration: task.duration, priority: task.priority })),
    })
    if (!editSnapshot.current) {
      editSnapshot.current = snapshot
      return
    }
    if (snapshot === editSnapshot.current) return
    const timer = window.setTimeout(() => {
      editSnapshot.current = snapshot
      void generatePlan()
    }, 900)
    return () => window.clearTimeout(timer)
  }, [availableWindows, dailyAdjustment, interruptionJobId, generatePlan, keepBuffer, loading, stage, tasks, temporaryConstraints, weeklyGoal, weekStatus?.new_week])

  const updateBlockDateTime = (index: number, field: 'start' | 'end', value: string) => {
    const selected = new Date(value)
    const monday = new Date(`${weekId}T00:00:00`)
    if (Number.isNaN(selected.getTime()) || Number.isNaN(monday.getTime())) return
    const dayIndex = Math.floor((new Date(selected.getFullYear(), selected.getMonth(), selected.getDate()).getTime() - monday.getTime()) / 86_400_000)
    if (dayIndex < 0 || dayIndex > 6) {
      toast(locale === 'zh' ? '请选择当前周内的时间' : 'Choose a time within this week')
      return
    }
    const hour = selected.getHours() + selected.getMinutes() / 60
    setBlocks((current) => current.map((block, blockIndex) => {
      if (blockIndex !== index) return block
      const updated = { ...block, day_index: dayIndex, [field]: hour }
      updated.start_at = new Date(blockDateTime(weekId, updated.day_index, updated.start)).toISOString()
      updated.end_at = new Date(blockDateTime(weekId, updated.day_index, updated.end)).toISOString()
      updated.session_minutes = Math.max(Math.round((updated.end - updated.start) * 60), 0)
      return updated
    }))
    setValidation(null)
  }

  const validatePlan = async () => {
    setSubmitting(true)
    try {
      const result = await apiRequest<{ validation: PlanValidation }>('/api/schedules/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_id: weekId, plan_patch: blocks }),
      })
      setValidation(result.validation)
      toast(result.validation.valid ? t('planning.validPlan') : t('planning.invalidPlan'))
      return result.validation
    } catch (error) {
      toast(error instanceof Error ? error.message : t('planning.validateFailed'))
      return null
    } finally {
      setSubmitting(false)
    }
  }

  const confirmPlan = async () => {
    if (!decision) return
    setSubmitting(true)
    try {
      const checked = validation?.valid ? validation : await validatePlan()
      if (!checked?.valid) return
      const result = await apiRequest<any>('/api/schedules/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: decision.plan_id,
          rest_change_confirmation: restAccepted ? restPolicy?.rest_confirmation_id : undefined,
          week_id: weekId,
          edit_episode_id: decision.edit_episode_id,
          plan_patch: blocks,
          unscheduled_tasks: decision.unscheduled_tasks || [],
          ai_task_analysis: decision.ai_task_analysis || {},
          decision: { ...decision, plan_patch: blocks },
          ...(rationaleRequired ? {
            rationale: {
              raw_user_response: rationale,
              reason_codes: ['user_adjusted_schedule'],
              generalizability: 'not_sure',
              affected_task_ids: Array.from(new Set(blocks.map((block) => block.task_id))),
            },
          } : {}),
        }),
      })
      if (result.requires_rationale) {
        setRationaleRequired(true)
        toast(t('planning.rationaleRequired'))
        return
      }
      const activePlanResult = await apiRequest<PlanResourceEnvelope<{ plan: PlanDecision | null }>>('/api/plans/active')
      setRationaleRequired(false)
      setDecision(null)
      setBlocks([])
      setValidation(null)
      setStage('setup')
      window.dispatchEvent(new CustomEvent('humanos:plan-updated', {
        detail: { source: 'plan-confirmation', planRevision: activePlanResult.data.plan?.plan_revision },
      }))
      toast(t('planning.confirmed'))
      if (interruptionJobId) window.location.assign('/app')
    } catch (error) {
      toast(error instanceof Error ? error.message : t('planning.confirmFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const rolloverWeek = async () => {
    setSubmitting(true)
    try {
      await apiRequest('/api/weeks/rollover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_id: weekId, use_last_week: rolloverMode === 'use_last', carry_task_ids: carryIds }),
      })
      await loadPlanningState()
      toast(t('planning.weekStarted'))
    } catch (error) {
      toast(error instanceof Error ? error.message : t('planning.rolloverFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const retryInterruptionDraft = async () => {
    setSubmitting(true)
    try {
      const result = await apiRequest<{ job: { job_id: string } }>('/api/schedules/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_id: weekId, source: 'mutation_replan', replan_scope: 'today',
          adjustment_trigger: 'help_decide_break', affected_task_ids: [searchParams.get('task_id')],
          request_id: `${searchParams.get('recommendation_id')}:break-replan:${crypto.randomUUID()}` }),
      })
      const params = new URLSearchParams(searchParams.toString())
      params.set('job_id', result.job.job_id)
      window.location.assign(`/app/plan?${params}`)
    } catch (error) { toast(error instanceof Error ? error.message : t('planning.generateFailed')) }
    finally { setSubmitting(false) }
  }

  if (loadError && interruptionJobId) {
    return <div className="p-6 space-y-4"><p>{locale === 'zh' ? '无法加载这次休息的待确认草案，请重试或返回工作台查看当前安排。' : 'Cannot load the pending break adjustment. Retry or check your current plan in Workspace.'}</p><p role="alert">{loadError}</p><Button onClick={() => void loadPlanningState()}>{locale === 'zh' ? '重新加载' : 'Reload'}</Button><Button disabled={submitting || !weekId} onClick={() => void retryInterruptionDraft()}>{locale === 'zh' ? '重新生成调整草案' : 'Generate a new draft'}</Button></div>
  }

  if (loading) {
    return <LoadingSkeleton label={locale === 'zh' ? '正在加载本周计划…' : 'Loading your weekly plan…'} />
  }

  return (
    <main className="humanos-page-enter humanos-operating-page h-full min-h-0 overflow-y-auto overscroll-contain px-4 pb-28 pt-6 md:px-8">
      <div className="mx-auto max-w-6xl"><NextWeekPlanner /></div>
      {planningPhase && <div className="mx-auto mb-5 max-w-6xl"><ProcessingNotice label={planningPhase === 'saving' ? (locale === 'zh' ? '正在保存本周设置…' : 'Saving weekly setup…') : (locale === 'zh' ? '正在等待排程结果，完成后会显示草案供你确认…' : 'Waiting for scheduling results. A draft will be shown for your review…')} /></div>}
      <div className="humanos-operating-container mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link href="/app" className="mb-3 inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />{t('planning.workspace')}</Link>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">HumanOS / {weekId}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-5xl">{t('planning.title')}</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">{t('planning.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            {(['setup', 'review'] as Stage[]).map((item, index) => (
              <div key={item} className={`rounded-full px-3 py-1 text-xs ${stage === item ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{index + 1}. {t(`planning.${item}`)}</div>
            ))}
          </div>
        </header>

        {selectedTaskId && <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{locale==='zh'?'正在安排：':'Scheduling: '}{tasks.find(t=>t.id===selectedTaskId)?.title || (locale==='zh'?'所选任务':'Selected task')}</div>}
        {weekStatus?.new_week && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader><CardTitle className="text-lg">{t('planning.newWeek')}</CardTitle><CardDescription>{t('planning.newWeekDescription')}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2"><button type="button" onClick={() => setRolloverMode('use_last')} className={`rounded-xl border p-4 text-left ${rolloverMode === 'use_last' ? 'border-primary bg-primary/10' : ''}`}><strong>{locale === 'zh' ? '以上周为起点' : 'Use last week as a starting point'}</strong><p className="mt-1 text-xs text-muted-foreground">{locale === 'zh' ? '保留可用时间、缓冲和重复例行事项，不复制一次性事件。' : 'Keep availability, buffers, and recurring routines without copying one-off events.'}</p></button><button type="button" onClick={() => setRolloverMode('fresh')} className={`rounded-xl border p-4 text-left ${rolloverMode === 'fresh' ? 'border-primary bg-primary/10' : ''}`}><strong>{locale === 'zh' ? '全新开始' : 'Start fresh'}</strong><p className="mt-1 text-xs text-muted-foreground">{locale === 'zh' ? '重新填写本周时间、固定事项、目标和临时约束。' : 'Re-enter availability, fixed events, goals, and temporary constraints.'}</p></button></div>
              <p className="text-sm font-medium">{locale === 'zh' ? '选择要带入新周的未完成任务' : 'Choose unfinished tasks to carry into the new week'}</p>
              {tasks.map((task) => (
                <label key={task.id} className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={carryIds.includes(String(task.id))} onChange={(event) => setCarryIds((current) => event.target.checked ? [...current, String(task.id)] : current.filter((id) => id !== task.id))} />
                  {task.title}
                </label>
              ))}
              <Button onClick={rolloverWeek} disabled={submitting}>{t('planning.startWeek')}</Button>
            </CardContent>
          </Card>
        )}

        {adjustmentTrigger && (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader><CardTitle className="text-lg">{adjustmentTrigger === 'continue-later' ? (locale === 'zh' ? '审查稍后继续的时间调整' : 'Review the continue-later adjustment') : (locale === 'zh' ? '根据当前状态重新规划' : 'Replan from your current state')}</CardTitle><CardDescription>{adjustmentTrigger === 'continue-later' ? (locale === 'zh' ? '这里只调整受中断影响的 Session。正式日历会保持不变，直到你应用这份变更。' : 'Only sessions affected by the interruption are adjusted. The formal calendar stays unchanged until you apply this change.') : (locale === 'zh' ? '仅在你选择生成后，系统才会使用最新状态调整今天剩余的可移动片段。固定安排、受保护休息和范围外日程保持不变；草案需要确认后才生效。' : 'Choose to generate a draft using your latest state for today’s remaining movable segments. Fixed commitments, protected breaks and out-of-scope arrangements stay unchanged. Confirmation is required to apply the draft.')}</CardDescription></CardHeader>
          </Card>
        )}

        {localDiff && (
          <Card className="overflow-hidden border-primary/40">
            <CardHeader className="bg-primary/5"><CardTitle className="text-lg">{locale === 'zh' ? '局部日历变更' : 'Local calendar change'}</CardTitle><CardDescription>{locale === 'zh' ? `基于计划 R${localDiff.base_plan_revision}，未影响的任务不会移动。` : `Based on plan R${localDiff.base_plan_revision}. Unaffected tasks will not move.`}</CardDescription></CardHeader>
            <CardContent className="space-y-4 pt-5">
              {localDiff.changes.map((change, index) => <div key={`${change.after.block_id || change.after.task_id}-${index}`} className="grid gap-3 rounded-2xl border bg-background p-4 md:grid-cols-[1fr_auto_1fr]"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{locale === 'zh' ? '原安排' : 'Before'}</p><p className="mt-1 font-medium">{taskName.get(String(change.before.task_id || '')) || (locale === 'zh' ? '当前任务' : 'Current task')}</p><p className="mt-1 text-sm text-muted-foreground">{formatDateTime(change.before.start_at)} – {formatDateTime(change.before.end_at)}</p></div><div className="self-center text-center text-primary">→</div><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">{locale === 'zh' ? '建议安排' : 'After'}</p><p className="mt-1 font-medium">{taskName.get(String(change.after.task_id || '')) || (locale === 'zh' ? '当前任务' : 'Current task')}</p><p className="mt-1 text-sm text-muted-foreground">{formatDateTime(change.after.start_at)} – {formatDateTime(change.after.end_at)}</p></div></div>)}
              <div className="grid gap-3 text-sm md:grid-cols-2"><div className="rounded-xl bg-muted/60 p-3"><strong>{locale === 'zh' ? '可能受影响' : 'Potentially affected'}</strong><p className="mt-1 text-muted-foreground">{locale === 'zh' ? `${localDiff.affected_execution_session_ids.length} 个后续 Session` : `${localDiff.affected_execution_session_ids.length} downstream session(s)`}</p></div><div className="rounded-xl bg-emerald-500/10 p-3"><strong>{locale === 'zh' ? '受保护内容' : 'Protected'}</strong><p className="mt-1 text-muted-foreground">{localDiff.protected_resources.map((item) => item.replaceAll('_', ' ')).join(' · ')}</p></div></div>
            </CardContent>
          </Card>
        )}

        {stage === 'setup' && dailyAdjustment && (
          <Card><CardHeader><CardTitle>{locale === 'zh' ? '是否生成今天的调整方案？' : 'Generate an adjustment for today?'}</CardTitle><CardDescription>{locale === 'zh' ? '使用已保存的任务和设置。今天排不下的部分会明确列出，不会自动移到其他日期。' : 'Uses saved tasks and settings. Work that does not fit today stays explicitly unscheduled.'}</CardDescription></CardHeader><CardContent className="flex gap-3"><Button onClick={() => void generatePlan()} disabled={submitting || !weekId}>{locale === 'zh' ? '生成调整方案' : 'Generate adjustment'}</Button><Button variant="outline" asChild><Link href="/app">{locale === 'zh' ? '保持原计划' : 'Keep current plan'}</Link></Button></CardContent></Card>
        )}

        {stage === 'setup' && !dailyAdjustment && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Card>
              <CardHeader><CardTitle>{t('planning.weekContext')}</CardTitle><CardDescription>{t('planning.weekContextDescription')}</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <label className="grid gap-1.5 text-sm"><span>{t('planning.weeklyGoal')}</span><Input value={weeklyGoal} onChange={(event) => setWeeklyGoal(event.target.value)} /></label>
                <label className="grid gap-1.5 text-sm"><span>{t('planning.availableWindows')}</span><WeeklyAvailabilityPicker value={availableWindows} onChange={setAvailableWindows} /></label>
                <label className="grid gap-1.5 text-sm"><span>{t('planning.temporaryConstraints')}</span><textarea className="min-h-24 rounded-md border bg-background p-3 text-sm" value={temporaryConstraints} onChange={(event) => setTemporaryConstraints(event.target.value)} /></label>
                <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={keepBuffer} onChange={(event) => setKeepBuffer(event.target.checked)} />{t('planning.keepBuffer')}</label>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('planning.weekTasks')}</CardTitle><CardDescription>{t('planning.weekTasksDescription')}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                {tasks.length === 0 && <p className="text-sm text-muted-foreground">{t('planning.noTasks')}</p>}
                {tasks.map((task, index) => (
                  <div key={task.id || index} data-selected={task.id===selectedTaskId} className="min-w-0 space-y-3 rounded-xl border bg-background/70 p-3 data-[selected=true]:border-primary data-[selected=true]:ring-1 data-[selected=true]:ring-primary/20">
                    <div className="flex min-w-0 items-center gap-2">
                      <Input className="min-w-0 flex-1" aria-label={t('planning.taskTitle')} value={task.title || ''} disabled={titleSave[String(task.id)] === 'saving'} onBlur={() => void saveTitle(task)} onChange={(event) => { updateTask(index, 'title', event.target.value); setTitleSave(current => ({...current, [String(task.id)]: 'dirty'})) }} placeholder={t('planning.taskTitle')} />
                      <Button type="button" size="icon" variant="ghost" className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => void deleteTask(task)} aria-label={locale === 'zh' ? '删除任务' : 'Delete task'}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    {titleSave[String(task.id)] && <div className="flex items-center gap-2 text-xs" role={['failed','empty'].includes(titleSave[String(task.id)]) ? 'alert' : 'status'}>
                      <span>{({saving: locale === 'zh' ? '正在保存名称…' : 'Saving name…', saved: locale === 'zh' ? '名称已保存' : 'Name saved', dirty: locale === 'zh' ? '名称尚未保存，离开输入框时保存' : 'Name unsaved; saved when you leave the field', failed: locale === 'zh' ? '名称保存失败，请重试' : 'Name could not be saved; retry', empty: locale === 'zh' ? '名称不能为空' : 'Name cannot be empty'} as Record<string,string>)[titleSave[String(task.id)]]}</span>
                      {['failed','dirty'].includes(titleSave[String(task.id)]) && <Button size="sm" variant="outline" onClick={() => void saveTitle(task)}>{locale === 'zh' ? '保存名称' : 'Save name'}</Button>}
                    </div>}
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <div className="min-w-0 space-y-1.5 sm:col-span-2">
                        <p className="text-xs text-muted-foreground">{t('planning.deadline')}</p>
                        <DateTimePicker value={taskDateInput(task.deadline_at, profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)} onChange={(value) => updateTask(index, 'deadline_at', value)} ariaLabel={t('planning.deadline')} />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-xs text-muted-foreground">{locale === 'zh' ? '预计用时' : 'Estimated duration'}</p>
                        <DurationInput aria-label={locale === 'zh' ? '预计用时' : 'Estimated duration'} value={task.duration ?? ''} onValueChange={value => updateTask(index, 'duration', value === '' ? '' : Number(value))} maxMinutes={1440} zh={locale === 'zh'} />
                      </div>
                      <label className="grid min-w-0 content-start gap-1.5 text-xs text-muted-foreground">
                        <span>{locale === 'zh' ? '优先级' : 'Priority'}</span>
                        <select className="h-10 w-full rounded-md border bg-background px-2 text-sm text-foreground" value={String(task.priority || 'medium')} onChange={(event) => updateTask(index, 'priority', event.target.value)}><option value="high">{t('taskDialog.priorityHigh')}</option><option value="medium">{t('taskDialog.priorityMedium')}</option><option value="low">{t('taskDialog.priorityLow')}</option></select>
                      </label>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-end gap-2 pt-2 text-xs text-muted-foreground">{submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}<span>{submitting ? (locale === 'zh' ? '正在保存修改并更新草案…' : 'Saving changes and updating draft…') : (locale === 'zh' ? '名称单独保存；时间、时长和优先级修改会更新草案' : 'Names save separately; time, duration and priority changes refresh the draft')}</span></div>
              </CardContent>
            </Card>
          </div>
        )}

        {stage === 'review' && decision && (
          <div className="grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
            <Card>
              <CardHeader><CardTitle>{t('planning.reviewTitle')}</CardTitle><CardDescription>{decision.explanation || t('planning.reviewDescription')}</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <ScheduleExplanation decision={decision} locale={locale} />
                {Boolean(restPolicy?.rest_changes?.length) && <div className="space-y-3 rounded-xl border border-amber-400 p-4"><p className="font-semibold">{locale === 'zh' ? '本方案会调整休息，需要单独确认' : 'This draft changes rest and needs explicit consent'}</p>{restPolicy.rest_changes.map((change: any) => <p key={change.block_id} className="text-sm">{locale === 'zh' ? `原休息 ${change.before.start_at ? formatDateTime(change.before.start_at) : change.before.start}–${change.before.end_at ? formatDateTime(change.before.end_at) : change.before.end}：占用 ${change.consumed_minutes} 分钟，${change.remaining_minutes === 0 ? '本次剩余休息将取消' : `剩余 ${change.remaining_minutes} 分钟，从 ${change.after?.start_at ? formatDateTime(change.after.start_at) : change.after?.start} 开始`}。` : `Rest: ${change.consumed_minutes} minutes used; ${change.remaining_minutes} minutes remain${change.remaining_minutes === 0 ? ' (cancelled)' : ''}.`}</p>)}<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restAccepted} onChange={event => setRestAccepted(event.target.checked)} />{locale === 'zh' ? '我已了解并同意上述休息调整' : 'I understand and agree to these rest changes'}</label></div>}

                {blocks.map((block, index) => (
                  <div key={block.block_id || `${block.task_id}-${index}`} className="grid items-center gap-3 rounded-xl border p-3 md:grid-cols-[1fr_1fr_1fr]">
                    <div><p className="font-medium">{taskName.get(block.task_id) || block.title}</p><p className="text-xs text-muted-foreground">{block.kind || 'task_session'}</p></div>
                    <label className="grid gap-1 text-xs text-muted-foreground"><span>{locale === 'zh' ? '开始日期和时间' : 'Start date and time'}</span><DateTimePicker value={blockDateTime(weekId, block.day_index, block.start)} onChange={(value) => updateBlockDateTime(index, 'start', value)} /></label>
                    <label className="grid gap-1 text-xs text-muted-foreground"><span>{locale === 'zh' ? '结束日期和时间' : 'End date and time'}</span><DateTimePicker value={blockDateTime(weekId, block.day_index, block.end)} onChange={(value) => updateBlockDateTime(index, 'end', value)} /></label>
                  </div>
                ))}
                <div className="flex justify-between pt-3">{localDiff ? <Button variant="outline" asChild><Link href="/app">{locale === 'zh' ? '暂不调整' : 'Not now'}</Link></Button> : <Button variant="outline" onClick={() => setStage('setup')}>{t('planning.backToSetup')}</Button>}<div className="flex gap-2"><Button variant="outline" onClick={validatePlan} disabled={submitting}><ShieldCheck className="mr-2 h-4 w-4" />{t('planning.validate')}</Button><Button onClick={confirmPlan} disabled={submitting || validation?.valid === false || (Boolean(restPolicy?.rest_changes?.length) && !restAccepted)}><CalendarCheck className="mr-2 h-4 w-4" />{localDiff ? (locale === 'zh' ? '应用变更' : 'Apply changes') : t('planning.confirm')}</Button></div></div>
              </CardContent>
            </Card>
            <div className="space-y-4">
              <Card className={validation?.valid ? 'border-emerald-500/40' : validation ? 'border-destructive/40' : ''}><CardHeader><CardTitle className="text-lg">{t('planning.validation')}</CardTitle><CardDescription>{validation ? (validation.valid ? t('planning.validPlan') : t('planning.invalidPlan')) : t('planning.notValidated')}</CardDescription></CardHeader><CardContent className="space-y-2">{validation?.violations?.map((item, index) => <DecisionReasonMessage key={index} code={item.type} detail={item.message} locale={locale} />)}</CardContent></Card>
              {Boolean(decision.unscheduled_tasks?.length) && <Card><CardHeader><CardTitle className="text-lg">{t('planning.unscheduled')}</CardTitle></CardHeader><CardContent><pre className="whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(decision.unscheduled_tasks, null, 2)}</pre></CardContent></Card>}
              {rationaleRequired && <Card className="border-primary/40"><CardHeader><CardTitle className="text-lg">{t('planning.whyChanged')}</CardTitle><CardDescription>{t('planning.whyChangedDescription')}</CardDescription></CardHeader><CardContent><textarea className="min-h-28 w-full rounded-md border bg-background p-3 text-sm" value={rationale} onChange={(event) => setRationale(event.target.value)} /><Button className="mt-3 w-full" onClick={confirmPlan} disabled={!rationale.trim() || submitting}>{t('planning.submitRationale')}</Button></CardContent></Card>}
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
