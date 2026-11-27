'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import FullCalendar from '@fullcalendar/react'
import {
  CalendarDays,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  UserRound,
  X,
} from 'lucide-react'
import CustomHeader from '@/components/custom-header'
import { WorkspaceCalendar } from '@/components/workspace-calendar'
import { WorkspaceNavigationFrame } from '@/components/workspace-navigation-frame'
import { Button } from '@/components/ui/button'
import type {
  SimBlock,
  SimRun,
  ParticipantProfile,
} from '@/lib/contracts/simulation-contracts'
import { SimulationCalendar } from './calendar'
import { SimulationTour, START_SIMULATION_TOUR } from './tour'
import { SimulationSignOut } from './sign-out'
import { stamp } from './common'
import { PersonalInput } from './personal-input'

export type ParticipantWorkspaceProps = {
  run: SimRun | null
  profile?: ParticipantProfile
  userId: string
  selector?: ReactNode
  form?: ReactNode
  error?: string
  loading?: boolean
  busy?: boolean
  onRefresh?: () => void
  onEditSetup?: () => void
  onAction?: (path: string, body?: Record<string, unknown>) => Promise<void>
}

export function ParticipantWorkspace({
  run,
  profile,
  userId,
  selector,
  form,
  error,
  loading,
  busy,
  onRefresh,
  onEditSetup,
  onAction,
}: ParticipantWorkspaceProps) {
  const calendarRef = useRef<FullCalendar>(null)
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true)
  const [panel, setPanel] = useState<'current' | 'pending'>('pending')
  const [modal, setModal] = useState<
    | 'questions'
    | 'review'
    | 'profile'
    | 'progress'
    | 'tasks'
    | 'personal-input'
    | null
  >(null)
  const [selectedTask, setSelectedTask] = useState<string | null>(null)
  const [draft, setDraft] = useState<SimBlock[] | undefined>()
  const [showActive, setShowActive] = useState(false)
  const [reason, setReason] = useState(''),
    [ack, setAck] = useState(false)
  const [progress, setProgress] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  const waiting = !!busy || !!run?.pending_job_id
  const done = run?.status === 'completed'
  const ready =
    !!run &&
    run.participant_setup_complete !== false &&
    !waiting &&
    !run.pending_batch &&
    !run.proposed_plan &&
    !done &&
    run.status !== 'awaiting_final'
  const canEditInput =
    !!run &&
    !waiting &&
    !done &&
    !run.pending_batch &&
    !run.proposed_plan &&
    run.status !== 'awaiting_final'
  const zone = run?.scenario.timezone || 'Asia/Shanghai'
  useEffect(() => {
    if (matchMedia('(max-width: 767px)').matches) {
      setLeftOpen(false)
      setRightOpen(false)
    }
  }, [])
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      calendarRef.current?.getApi().updateSize(),
    )
    return () => cancelAnimationFrame(frame)
  }, [leftOpen, rightOpen, run?.id])
  useEffect(() => {
    if (run) calendarRef.current?.getApi().gotoDate(run.simulated_at)
  }, [run?.simulated_at, run?.id])
  useEffect(() => {
    if (run?.participant_setup_complete === false) setModal('personal-input')
  }, [run?.id, run?.participant_setup_complete])
  useEffect(() => {
    if (run?.pending_batch) setModal('questions')
    else setModal((old) => (old === 'questions' ? null : old))
  }, [run?.pending_batch?.id])
  useEffect(() => {
    setDraft(undefined)
    setReason('')
    setAck(false)
    setShowActive(false)
    if (!run?.proposed_plan) setModal((old) => (old === 'review' ? null : old))
  }, [run?.proposed_plan?.id])
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !document.querySelector('[data-simulation-tour]')
      ) {
        setModal(null)
        setSelectedTask(null)
      }
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [])
  const act = async (path: string, body?: Record<string, unknown>) => {
    if (!onAction) return
    setNotice('')
    await onAction(path, body)
  }
  const click = (path: string, body?: Record<string, unknown>) => {
    void act(path, body).catch(() => {})
  }
  const askState = () => {
    if (run?.pending_batch) setModal('questions')
    else click('check-in')
  }
  const calendarRun = run && showActive ? { ...run, proposed_plan: null } : run
  const pending = (run?.scenario.tasks || [])
    .map((task) => {
      const scheduled = (run?.active_plan?.blocks || [])
        .filter((b) => b.task_id === task.id)
        .reduce(
          (n, b) => n + (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000,
          0,
        )
      return {
        task,
        minutes: Math.max(
          0,
          (run?.remaining[task.id] ?? task.minutes) - scheduled,
        ),
      }
    })
    .filter((t) => t.minutes > 0)
  const current = (run?.scenario.tasks || []).filter((t) =>
    run?.active_plan?.blocks.some((b) => b.task_id === t.id),
  )
  const profileAnswers = run?.profile_answers?.length
    ? run.profile_answers
    : (profile?.answers || []).map((a) => ({
        title: a.question.title,
        value: a.value,
        display_value: Array.isArray(a.value)
          ? a.value
              .map(
                (v) =>
                  a.question.options[
                    a.question.option_values?.indexOf(String(v)) ?? -1
                  ] || v,
              )
              .join('、')
          : a.question.options[
              a.question.option_values?.indexOf(String(a.value)) ?? -1
            ] || String(a.value),
      }))
  const selected = run?.scenario.tasks.find((t) => t.id === selectedTask)
  const questionPhase = run?.pending_batch?.phase
  const scope =
    modal === 'personal-input'
      ? 'participant-workspace-personal-input'
      : modal === 'questions' && run?.pending_batch
        ? `participant-${questionPhase === 'profile' ? 'profile' : questionPhase === 'node' || questionPhase === 'initial_state' ? 'node' : questionPhase === 'final' ? 'final' : 'feedback'}`
        : modal === 'review'
          ? 'participant-workspace-review'
          : modal === 'progress'
            ? 'participant-workspace-progress'
            : modal || selected
              ? 'participant-workspace-details'
              : done
                ? 'participant-workspace-completed'
                : error || run?.error
                  ? 'participant-workspace-error'
                  : waiting
                    ? 'participant-workspace-waiting'
                    : 'participant-workspace'
  const status = loading
    ? '正在读取…'
    : done
      ? '本次模拟已完成，回答与选择均已保存。'
      : run?.pending_batch?.phase === 'final'
        ? '请填写体验评价'
        : run?.pending_batch
          ? '请完成当前填写'
          : run?.proposed_plan
            ? '有新的计划建议，等待你确认'
            : waiting
              ? '正在生成建议，请稍候…'
              : run?.active_plan
                ? '计划已确认并保存。'
                : run
                  ? run.participant_setup_complete === false
                    ? '请先填写自己的任务和可用时间'
                    : '尚未确认计划'
                  : '正在准备工作台'
  return (
    <div
      data-simulation-app
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground"
    >
      <SimulationTour scope={scope} userId={userId} ready={!loading} />
      <WorkspaceNavigationFrame className="h-auto min-h-14 flex-wrap gap-y-1 py-2 sm:h-14 sm:flex-nowrap sm:py-0">
        <nav className="order-last flex w-full min-w-0 basis-full items-center gap-2 overflow-x-auto whitespace-nowrap sm:order-none sm:w-auto sm:flex-1 sm:basis-auto">
          <Link
            href="/app"
            aria-current="page"
            className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
          >
            <CalendarDays className="h-4 w-4" />
            工作台
          </Link>
          <button
            type="button"
            disabled={!run}
            onClick={() => setModal('tasks')}
            className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            任务
          </button>
          <button
            type="button"
            disabled={!canEditInput && !(!run && onEditSetup)}
            onClick={() => {
              if (!run && onEditSetup) onEditSetup()
              else setModal('personal-input')
            }}
            className="rounded-md px-3 py-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            任务与时间设置
          </button>
        </nav>
        <button
          type="button"
          className="ml-auto mr-3 shrink-0 whitespace-nowrap text-xs text-primary sm:ml-0"
          onClick={() => window.dispatchEvent(new Event(START_SIMULATION_TOUR))}
        >
          ↖ 操作引导
        </button>
        <button
          type="button"
          aria-label="打开个人资料"
          className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-card"
          onClick={() => setModal('profile')}
        >
          <UserRound className="h-4 w-4" />
        </button>
        <SimulationSignOut />
      </WorkspaceNavigationFrame>
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm"
        data-tour="run-summary"
      >
        <p
          role="status"
          className={
            done || run?.active_plan
              ? 'text-emerald-700'
              : 'text-muted-foreground'
          }
        >
          {status}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {selector}
          {run?.pending_batch && (
            <Button
              data-tour="answer-open"
              size="sm"
              variant="outline"
              onClick={() => setModal('questions')}
            >
              {questionPhase === 'final' ? '填写体验评价' : '继续填写'}
            </Button>
          )}
          {run?.proposed_plan && (
            <Button
              size="sm"
              data-tour="open-review"
              onClick={() => setModal('review')}
            >
              查看并确认建议
            </Button>
          )}
        </div>
      </div>
      {(error || run?.error) && (
        <div
          role="alert"
          data-tour="run-error"
          className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-rose-50 px-4 py-2 text-sm text-rose-800"
        >
          {error || run?.error}
          <span>已保存的回答和已确认计划保留。</span>
          <button
            data-tour="refresh-workspace"
            onClick={onRefresh}
            className="underline"
          >
            重新读取
          </button>
        </div>
      )}
      {notice && notice !== status && (
        <p
          role="status"
          className="shrink-0 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"
        >
          {notice}
        </p>
      )}
      {run?.revealed_events.at(-1) && (
        <div className="shrink-0 border-b bg-amber-50 px-4 py-2 text-sm">
          <strong>{run.revealed_events.at(-1)?.title}</strong> ·{' '}
          {run.revealed_events.at(-1)?.description}
        </div>
      )}
      <CustomHeader
        key={run?.id || 'unassigned'}
        calendarRef={calendarRef}
        clock={run ? { now: run.simulated_at, timezone: zone } : undefined}
        onOpenGuide={() =>
          window.dispatchEvent(new Event(START_SIMULATION_TOUR))
        }
      />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {leftOpen && (
          <aside
            id="participant-state"
            className="flex h-full w-[208px] shrink-0 flex-col border-r bg-muted/40"
          >
            <section className="grid content-start gap-4 overflow-y-auto p-4">
              <h2 className="text-sm font-semibold" data-tour="workspace-state">
                今日状态
              </h2>
              {run?.reported_state?.mood && (
                <p className="my-2 text-sm">心情：{run.reported_state.mood}</p>
              )}
              {run?.daily_feedback?.available && (
                <div className="my-3 text-sm">
                  <p>
                    {run.daily_feedback.date} ·{' '}
                    {run.daily_feedback.submitted
                      ? '每日反馈已保存'
                      : '每日反馈未填写'}
                  </p>
                  <Button
                    data-tour="daily-feedback"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={
                      !ready ||
                      !run.initial_submitted ||
                      run.daily_feedback.submitted
                    }
                    onClick={() => click('daily-feedback')}
                  >
                    填写每日反馈
                  </Button>
                </div>
              )}
              <dl className="grid gap-3 text-sm tabular-nums">
                {(['energy', 'focus', 'stress'] as const).map((key) => (
                  <div
                    key={key}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <dt className="text-muted-foreground">
                      {{ energy: '精力', focus: '专注', stress: '压力' }[key]}
                    </dt>
                    <dd>
                      {typeof run?.reported_state?.values[key] === 'number'
                        ? `${run.reported_state.values[key]}/7`
                        : '未填写'}
                    </dd>
                  </div>
                ))}
              </dl>
              {run?.reported_state?.simulated_at && (
                <p className="text-[11px] text-muted-foreground">
                  {stamp(run.reported_state.simulated_at, zone)} 更新
                </p>
              )}
              <Button
                data-tour="check-in"
                variant="outline"
                size="sm"
                disabled={
                  !run ||
                  waiting ||
                  done ||
                  (!run.pending_batch && (!ready || !run.initial_submitted))
                }
                onClick={askState}
              >
                {run?.reported_state?.reported_at ? '更新状态' : '填写今日状态'}
              </Button>
              {run && (
                <p className="text-xs leading-5 text-muted-foreground">
                  {run.scenario.description}
                </p>
              )}
              {!run && (
                <p
                  className="break-all text-xs leading-5 text-muted-foreground"
                  data-tour="account-id"
                >
                  我的账号编号：{userId}
                  <br />
                  完成首次设置后即可进入工作台。
                </p>
              )}
            </section>
          </aside>
        )}
        <button
          type="button"
          aria-label={leftOpen ? '收起今日状态' : '展开今日状态'}
          aria-expanded={leftOpen}
          aria-controls="participant-state"
          data-tour="toggle-state"
          className="z-40 flex w-5 shrink-0 items-center justify-center border-r bg-muted/20 text-muted-foreground hover:bg-muted"
          onClick={() => {
            setLeftOpen(!leftOpen)
            if (!leftOpen && matchMedia('(max-width: 767px)').matches)
              setRightOpen(false)
          }}
        >
          {leftOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </button>
        <section
          className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-1"
          aria-label="工作台日历"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 pb-1 text-xs text-muted-foreground">
            <span data-tour="run-calendar">
              {run?.proposed_plan && !showActive
                ? '待确认建议 · 尚未保存'
                : '已确认日历'}
            </span>
            {run?.proposed_plan && (
              <button
                className="text-primary underline"
                onClick={() => setShowActive(!showActive)}
              >
                {showActive ? '查看建议' : '查看已确认计划'}
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {calendarRun ? (
              <SimulationCalendar
                workspace
                calendarRef={calendarRef}
                run={calendarRun}
                draft={!showActive ? draft : undefined}
                onSelectTask={setSelectedTask}
                onEdit={
                  !showActive &&
                  run?.proposed_plan &&
                  !waiting &&
                  !run.pending_batch
                    ? (blocks) => {
                        setDraft(blocks)
                        setModal('review')
                      }
                    : undefined
                }
              />
            ) : (
              <WorkspaceCalendar
                ref={calendarRef}
                events={[]}
                editable={false}
              />
            )}
          </div>
        </section>
        <button
          type="button"
          aria-label={rightOpen ? '收起任务面板' : '展开任务面板'}
          aria-expanded={rightOpen}
          aria-controls="participant-tasks"
          data-tour="toggle-tasks"
          className="z-40 flex w-5 shrink-0 items-center justify-center border-l bg-muted/20 text-muted-foreground hover:bg-muted"
          onClick={() => {
            setRightOpen(!rightOpen)
            if (!rightOpen && matchMedia('(max-width: 767px)').matches)
              setLeftOpen(false)
          }}
        >
          {rightOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </button>
        {rightOpen && (
          <aside
            id="participant-tasks"
            className="flex h-full w-[280px] shrink-0 flex-col border-l bg-background"
          >
            <div
              className="flex shrink-0 gap-2 border-b p-3"
              data-tour="workspace-tasks"
            >
              {(['current', 'pending'] as const).map((tab) => (
                <button
                  type="button"
                  key={tab}
                  aria-pressed={panel === tab}
                  className={`rounded-md px-3 py-2 text-sm ${panel === tab ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
                  onClick={() => setPanel(tab)}
                >
                  {tab === 'current' ? '当前工作' : '待安排'}
                </button>
              ))}
            </div>
            <div className="px-3 pt-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!canEditInput && !(!run && onEditSetup)}
                onClick={() => {
                  if (!run && onEditSetup) onEditSetup()
                  else setModal('personal-input')
                }}
              >
                ＋ 添加 / 编辑我的任务
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {!run ? (
                <p className="text-sm text-muted-foreground">
                  {loading
                    ? '正在读取任务…'
                    : onEditSetup
                      ? '任务和可用时间已保存，工作台载入后在此显示。你可以继续修改任务与时间设置。'
                      : '请先完成自己的任务与时间设置。'}
                </p>
              ) : panel === 'pending' ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {pending.length} 项待安排
                  </p>
                  {pending.map(({ task, minutes }) => (
                    <article
                      key={task.id}
                      className="space-y-2 rounded-xl border p-3 text-sm"
                    >
                      <button
                        className="text-left font-medium hover:text-primary"
                        data-help="打开这个任务的详情，查看工作量、截止时间与要求；查看不会修改任务。"
                        onClick={() => setSelectedTask(task.id)}
                      >
                        {task.title}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        待安排 {Math.round(minutes)} 分钟
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!ready || !run.initial_submitted}
                        onClick={() => click('generate')}
                      >
                        安排
                      </Button>
                    </article>
                  ))}
                  {run.proposed_plan && (
                    <p className="text-xs text-muted-foreground">
                      新的建议尚待确认，确认成功后更新任务安排。
                    </p>
                  )}
                </>
              ) : (
                <>
                  {!current.length && (
                    <p className="text-sm text-muted-foreground">
                      暂无已确认工作段。
                    </p>
                  )}
                  {current.map((task) => (
                    <article
                      key={task.id}
                      className="space-y-2 rounded-xl border p-3 text-sm"
                    >
                      <button
                        className="text-left font-medium hover:text-primary"
                        data-help="打开这个任务的详情，查看工作量、截止时间与要求；查看不会修改任务。"
                        onClick={() => setSelectedTask(task.id)}
                      >
                        {task.title}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        剩余 {run.remaining[task.id]} 分钟
                      </p>
                      {run.active_plan?.blocks
                        .filter((b) => b.task_id === task.id)
                        .map((b, i) => (
                          <p key={i} className="text-xs text-muted-foreground">
                            {stamp(b.start_at, zone)}–{stamp(b.end_at, zone)}
                          </p>
                        ))}
                    </article>
                  ))}
                </>
              )}
            </div>
            <div className="grid shrink-0 gap-2 border-t p-4">
              <Button
                data-tour="progress-panel"
                variant="outline"
                disabled={!run?.active_plan || !ready}
                onClick={() => setModal('progress')}
              >
                报告任务进展
              </Button>
              <Button
                data-tour="generate"
                variant="outline"
                disabled={!ready || !run?.initial_submitted}
                onClick={() => click('generate')}
              >
                {waiting
                  ? 'AI 正在处理…'
                  : run?.error
                    ? '重试生成'
                    : run?.active_plan ? 'AI 重新安排' : 'AI 生成计划'}
              </Button>
            </div>
          </aside>
        )}
      </div>
      {(modal || selected) && (
        <div
          data-runtime-dialog
          role="dialog"
          aria-modal="true"
          aria-label={
            selected
              ? '任务详情'
              : modal === 'personal-input'
                ? '我的任务与时间'
                : modal === 'questions'
                  ? '填写当前信息'
                  : modal === 'review'
                    ? '审核安排'
                    : modal === 'progress'
                      ? '报告任务进展'
                      : modal === 'tasks'
                        ? '任务列表'
                        : '个人资料'
          }
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
        >
          <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
              <h2 className="font-semibold" data-tour="workspace-dialog">
                {selected
                  ? selected.title
                  : modal === 'personal-input'
                    ? '我的任务与时间'
                    : modal === 'questions'
                      ? questionPhase === 'profile'
                        ? '开始前，了解你的情况'
                        : questionPhase === 'final'
                          ? '体验评价'
                          : questionPhase === 'daily_feedback'
                            ? '每日反馈 · ' + run?.daily_feedback?.date
                            : '当前情况与反馈'
                      : modal === 'review'
                        ? '审核安排'
                        : modal === 'progress'
                          ? '报告任务进展'
                          : modal === 'tasks'
                            ? '任务列表'
                            : '个人资料'}
              </h2>
              <button
                type="button"
                className="ml-auto mr-3 shrink-0 text-xs text-primary"
                onClick={() =>
                  window.dispatchEvent(new Event(START_SIMULATION_TOUR))
                }
              >
                ↖ 操作引导
              </button>
              <button
                data-tour="close-panel"
                type="button"
                aria-label="收起面板"
                onClick={() => {
                  setModal(null)
                  setSelectedTask(null)
                }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 space-y-4 overflow-y-auto p-6">
              {(error || run?.error) && (
                <p
                  role="alert"
                  className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800"
                >
                  {error || run?.error}
                </p>
              )}
              {selected ? (
                <>
                  <p className="whitespace-pre-wrap text-sm">
                    {selected.description}
                  </p>
                  <dl className="grid gap-2 text-sm">
                    <div>总工作量：{selected.minutes} 分钟</div>
                    <div>剩余：{run?.remaining[selected.id]} 分钟</div>
                    <div>截止时间：{stamp(selected.deadline_at, zone)}</div>
                    <div>难度：{selected.difficulty}/10</div>
                    <div>
                      任务需求：
                      {{ high: '高', medium: '中', low: '低' }[
                        selected.demand
                      ] || selected.demand}
                    </div>
                  </dl>
                </>
              ) : modal === 'personal-input' && run ? (
                <PersonalInput
                  run={run}
                  busy={waiting}
                  onSave={async (input, expectedRevision) => {
                    await act('personal-input', {
                      input,
                      expected_revision: expectedRevision,
                    })
                    setModal(null)
                    setNotice(
                      '任务与时间已保存。请填写当前状态或生成新的安排。',
                    )
                  }}
                />
              ) : modal === 'questions' ? (
                form
              ) : modal === 'profile' ? (
                <>
                  <p className="break-all text-sm" data-tour="account-id">
                    账号编号：{userId}
                  </p>
                  <p className="text-sm">时区：{zone}</p>
                  {profileAnswers.length ? (
                    profileAnswers.map((a, i) => (
                      <div key={i} className="rounded-lg border p-3">
                        <p className="mb-1 text-sm font-medium">{a.title}</p>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {a.display_value ||
                            (typeof a.value === 'string'
                              ? a.value
                              : JSON.stringify(a.value))}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      尚未保存个人资料。请完成当前初始填写。
                    </p>
                  )}
                </>
              ) : modal === 'tasks' ? (
                <>
                  {run?.scenario.tasks.map((t) => (
                    <button
                      key={t.id}
                      className="block w-full rounded-xl border p-3 text-left text-sm"
                      onClick={() => setSelectedTask(t.id)}
                    >
                      <strong>{t.title}</strong>
                      <p className="mt-1 text-muted-foreground">
                        总计 {t.minutes} 分钟 · 剩余 {run.remaining[t.id]} 分钟
                      </p>
                    </button>
                  ))}
                </>
              ) : modal === 'review' && run?.proposed_plan ? (
                <>
                  <p
                    data-tour="review-panel"
                    className="whitespace-pre-wrap text-sm leading-6"
                  >
                    {run.proposed_plan.explanation}
                  </p>
                  {draft && (
                    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                      拖动修改尚未保存，请确认修改。校验失败会保留已确认计划。
                    </p>
                  )}
                  {run.proposed_plan.unscheduled.length > 0 && (
                    <div className="rounded-lg bg-amber-50 p-3 text-sm">
                      {run.proposed_plan.unscheduled.map((t) => (
                        <p key={t.task_id}>
                          {t.title}：{t.minutes} 分钟仍未安排
                        </p>
                      ))}
                      <label className="mt-2 block">
                        <input
                          type="checkbox"
                          checked={ack}
                          onChange={(e) => setAck(e.target.checked)}
                        />{' '}
                        我确认保留这些待安排工作量
                      </label>
                    </div>
                  )}
                  <label className="block text-sm">
                    原因或补充说明（可选）
                    <textarea
                      className="mt-2 w-full rounded-lg border p-3"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      data-tour="review-accept"
                      disabled={waiting || !!run.pending_batch}
                      onClick={() => {
                        void act(`plans/${run.proposed_plan!.id}/review`, {
                          response: draft ? 'modify' : 'accept',
                          edits: draft,
                          reason,
                          acknowledge_unscheduled: ack,
                        })
                          .then(() => {
                            setModal(null)
                            setNotice('计划已确认并保存。')
                          })
                          .catch(() => {})
                      }}
                    >
                      {draft ? '确认修改' : '接受并保存'}
                    </Button>
                    <Button
                      data-tour="review-reject"
                      variant="outline"
                      disabled={waiting || !!run.pending_batch}
                      onClick={() => {
                        void act(`plans/${run.proposed_plan!.id}/review`, {
                          response: 'reject',
                          reason,
                        })
                          .then(() => {
                            setModal(null)
                            setNotice('已拒绝建议，原已确认计划保留。')
                          })
                          .catch(() => {})
                      }}
                    >
                      拒绝建议
                    </Button>
                    {draft && (
                      <Button
                        variant="outline"
                        onClick={() => setDraft(undefined)}
                      >
                        还原拖动
                      </Button>
                    )}
                  </div>
                </>
              ) : modal === 'progress' && run ? (
                <form
                  className="space-y-4"
                  data-tour="workspace-progress"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const remaining = Object.fromEntries(
                      Object.entries(progress)
                        .filter(([, v]) => v !== '')
                        .map(([k, v]) => [k, Number(v)]),
                    )
                    void act('progress', { remaining_minutes: remaining })
                      .then(() => {
                        setProgress({})
                        setModal(null)
                        setNotice('任务进展已保存，正在重新评估安排。')
                      })
                      .catch(() => {})
                  }}
                >
                  <p className="text-sm text-muted-foreground">
                    填写发生变化的任务剩余分钟数。完成填 0，留空表示不更新。
                  </p>
                  {run.scenario.tasks.map((t) => (
                    <label key={t.id} className="block text-sm">
                      {t.title} · 当前剩余 {run.remaining[t.id]} 分钟
                      <input
                        className="mt-1 w-full rounded-lg border p-2"
                        type="number"
                        min={0}
                        max={14400}
                        step={1}
                        value={progress[t.id] || ''}
                        data-help="填写此任务还需要的分钟数，完成填 0；留空表示不更新。点击保存进展并重新评估后提交。"
                        placeholder="没有更新"
                        onChange={(e) =>
                          setProgress({ ...progress, [t.id]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  <Button
                    type="submit"
                    disabled={
                      !ready || !Object.values(progress).some((v) => v !== '')
                    }
                  >
                    保存进展并重新评估
                  </Button>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
