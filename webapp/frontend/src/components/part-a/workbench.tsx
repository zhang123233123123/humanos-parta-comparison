'use client'

import { useEffect, useRef, useState } from 'react'
import { ProfilePicker } from './profile-picker'
import { ChoicePicker } from './choice-picker'

type Window = {
  start_at: string
  end_at: string
  title?: string
  source?: string
}
type Task = {
  task_id: string
  title: string
  deliverable: string
  estimated_minutes: number
  priority: string
  deadline: string
  earliest_start: string
  minimum_chunk_minutes: number
}
type Scenario = {
  scenario_id: string
  title: string
  constraint_condition: string
  tasks: Task[]
}
type Profile = {
  participant: string
  submitted_at: string
  first_day_context: {
    date: string
    timezone: string
    availability: Window[]
    fixed_events: Window[]
  }
  original_profile_fields: unknown
  part_a_dimension_mapping: unknown
}
type Catalog = {
  scenarios: Scenario[]
  profiles: Profile[]
  model: string
  policy: string
}
type Messages = { role: string; content: string }[]
type Block = Window & { task_id: string; title: string; minutes: number }
type Check = { valid: boolean; violations: string[]; blocks: Block[] }
type Preview = {
  preview_hash: string
  scenario_id: string
  scenario_title: string
  profile_id: string
  model: string
  common: {
    date: string
    timezone: string
    availability: Window[]
    fixed_events: Window[]
  }
  conditions: { id: string; label: string; messages: Messages }[]
  parameters: object
  precheck: {
    can_attempt: boolean
    issues: string[]
    work_minutes: number
    net_available_minutes: number
    note: string
  }
  warnings: string[]
}
type Attempt = {
  number: number
  status: string
  messages: Messages
  request?: object
  raw_content?: string
  output?: unknown
  validation?: Check
  error?: string
  usage?: unknown
}
type Result = {
  id: string
  label: string
  status: string
  error?: string
  explanation?: string
  final?: Check
  attempts: Attempt[]
}
type Run = {
  id: string
  created_at: string
  status: string
  scenario_id: string
  profile_id: string
  preview: Preview
  results: Result[]
}
type RunSummary = Pick<
  Run,
  'id' | 'created_at' | 'status' | 'scenario_id' | 'profile_id'
>
type Mode = 'level' | 'score' | 'text'
const stateNames: Record<string, string> = {
  queued: '等待调用',
  running: '正在生成',
  valid: '时间校验通过',
  invalid: '时间校验未通过',
  error: '调用失败',
  interrupted: '服务重启中断',
  completed: '四条件全部通过',
  completed_with_errors: '已结束 · 存在未通过条件',
  calling: '正在调用',
}
const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50'
const buttonClass =
  'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed'

async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch('/api/part-a/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(data.message || `请求失败（${response.status}）`)
  return data.data
}
function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
function clock(value: string, timezone: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))
}
function TimeWindows({ windows }: { windows: Window[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {windows.length ? (
        windows.map((w, i) => (
          <li key={i}>
            {w.start_at.slice(11, 16)}–{w.end_at.slice(11, 16)} {w.title || ''}
          </li>
        ))
      ) : (
        <li>无记录</li>
      )}
    </ul>
  )
}
function exportRun(run: Run) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = `PartA_${run.profile_id}_${run.scenario_id}_${run.id}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export default function PartAWorkbench() {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [scenarioId, setScenarioId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [mode, setMode] = useState<Mode>('level')
  const [values, setValues] = useState<Record<string, string>>({})
  const [durations, setDurations] = useState<Record<string, string>>({})
  const [deadlines, setDeadlines] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Preview | null>(null)
  const [run, setRun] = useState<Run | null>(null)
  const [history, setHistory] = useState<RunSummary[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const inputRevision = useRef(0)
  const selectionRevision = useRef(0)
  const pendingStart = useRef<{ payload: object } | null>(null)
  const scenario = catalog?.scenarios.find((s) => s.scenario_id === scenarioId)
  const profile = catalog?.profiles.find((p) => p.participant === profileId)
  const runId = run?.id
  const active = run?.status === 'running' || run?.status === 'queued'
  function invalidate() {
    inputRevision.current++
    setPreview(null)
    pendingStart.current = null
    setError('')
  }
  async function load() {
    setLoading(true)
    setError('')
    try {
      const [c, h] = await Promise.all([
        api<Catalog>('catalog'),
        api<RunSummary[]>('runs'),
      ])
      setCatalog(c)
      setHistory(h)
      // Opening the workbench reads the catalog/history only. Inputs and runs
      // are selected by the researcher; never preload a previous smoke run.
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  useEffect(() => {
    if (!active || !runId) return
    let stopped = false
    const id = runId
    const poll = async () => {
      try {
        const fresh = await api<Run>('runs/' + id)
        if (!stopped) {
          setRun((current) => (current?.id === id ? fresh : current))
          setError('')
        }
        if (!stopped && !['running', 'queued'].includes(fresh.status))
          setHistory(await api<RunSummary[]>('runs'))
      } catch (e) {
        if (!stopped)
          setError('状态查询失败，记录仍保存在后端：' + (e as Error).message)
      }
    }
    const timer = setInterval(() => void poll(), 2500)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [runId, active])
  function payload() {
    if (!scenario || !profile) throw new Error('请先选择任务和 Profile。')
    const difficulties: Record<string, string | number> = {},
      overrides: Record<string, number> = {},
      deadlineOverrides: Record<string, string> = {}
    for (const t of scenario.tasks) {
      const v = values[t.task_id]?.trim()
      if (!v) throw new Error(`请填写「${t.title}」的难度。`)
      difficulties[t.task_id] = mode === 'score' ? Number(v) : v
      const duration = durations[t.task_id] ?? String(t.estimated_minutes)
      if (!duration.trim()) throw new Error(`请填写「${t.title}」的时长。`)
      overrides[t.task_id] = Number(duration)
      const deadline = deadlines[t.task_id] ?? t.deadline
      if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(deadline))
        throw new Error(`请填写「${t.title}」的有效截止时间（HH:mm）。`)
      if (deadline <= t.earliest_start)
        throw new Error(`「${t.title}」的截止时间必须晚于最早开始 ${t.earliest_start}。`)
      deadlineOverrides[t.task_id] = deadline
    }
    return {
      scenario_id: scenarioId,
      profile_id: profileId,
      difficulty_mode: mode,
      difficulties,
      duration_overrides: overrides,
      deadline_overrides: deadlineOverrides,
    }
  }
  async function inspect() {
    const revision = inputRevision.current
    setBusy(true)
    setError('')
    try {
      const p = await api<Preview>('preview', payload())
      if (revision === inputRevision.current) setPreview(p)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function generate() {
    if (!preview) return
    setBusy(true)
    setError('')
    selectionRevision.current++
    try {
      // Retain the request ID when a network response is lost; retry cannot double-charge.
      if (!pendingStart.current)
        pendingStart.current = {
          payload: {
            ...payload(),
            preview_hash: preview.preview_hash,
            request_id: crypto.randomUUID(),
          },
        }
      const created = await api<Run>('runs', pendingStart.current.payload)
      setRun(created)
      pendingStart.current = null
      setHistory(await api<RunSummary[]>('runs'))
    } catch (e) {
      setError(
        (e as Error).message +
          '；网络不确定时可先刷新记录，或再次点击使用同一请求编号重试。',
      )
    } finally {
      setBusy(false)
    }
  }
  async function selectRun(id: string) {
    if (!id) return
    const revision = ++selectionRevision.current
    setBusy(true)
    setError('')
    try {
      const r = await api<Run>('runs/' + id)
      if (revision === selectionRevision.current) setRun(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function refreshHistory() {
    setError('')
    try {
      setHistory(await api<RunSummary[]>('runs'))
      if (run) await selectRun(run.id)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 [color-scheme:light]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-5">
          <div>
            <span className="text-sm font-semibold tracking-wide text-indigo-600">
              HumanOS · RESEARCH WORKBENCH
            </span>
            <h1 className="mt-1 text-2xl font-bold">Part A · 单日四条件比较</h1>
          </div>
          <span className="rounded-full bg-indigo-50 px-4 py-2 text-sm text-indigo-700">
            内部预试 · 使用历史 Profile
          </span>
        </div>
      </header>
      <div className="mx-auto max-w-[1600px] space-y-6 p-6">
        <p className="text-sm leading-6 text-slate-600">
          由你选择任务与
          Profile、填写难度并核对提示词。预览不调用模型；只有点击“确认配置并调用模型生成”才启动四条件排程。
        </p>
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
            {!catalog && (
              <button
                className={buttonClass + ' ml-4'}
                onClick={() => void load()}
              >
                重新加载
              </button>
            )}
          </div>
        )}
        {loading && <p role="status">正在读取任务、Profile 和保存的记录…</p>}
        {!loading &&
          catalog &&
          (!catalog.scenarios.length || !catalog.profiles.length) && (
            <p>尚无可用素材，请补齐任务与首日 Profile 数据。</p>
          )}
        {catalog && (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold">1. 选择输入</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="min-w-0 space-y-2 text-sm">
                  <p>学习任务素材</p>
                  <ChoicePicker
                    label="学习任务素材"
                    placeholder="请选择任务素材"
                    disabled={busy}
                    value={scenarioId}
                    options={catalog.scenarios.map((s) => ({
                      value: s.scenario_id,
                      label: `${s.scenario_id} · ${s.title} · 原${s.constraint_condition}情境`,
                    }))}
                    onChange={(id) => {
                      invalidate()
                      setScenarioId(id)
                      setValues({})
                      setDurations({})
                      setDeadlines({})
                    }}
                  />
                </div>
                <div className="space-y-2 text-sm">
                  <p>历史 Profile</p>
                  <ProfilePicker
                    value={profileId}
                    options={catalog.profiles.map((p) => p.participant)}
                    disabled={busy}
                    onChange={(id) => {
                      invalidate()
                      setProfileId(id)
                    }}
                  />
                </div>
                <div className="min-w-0 space-y-2 text-sm">
                  <p>本次难度表达（三选一）</p>
                  <ChoicePicker
                    label="难度表达方式"
                    disabled={busy}
                    value={mode}
                    options={[
                      { value: 'level', label: '高 / 中 / 低' },
                      { value: 'score', label: '0–100 整数分' },
                      { value: 'text', label: '主观文字描述' },
                    ]}
                    onChange={(value) => {
                      invalidate()
                      setMode(value as Mode)
                      setValues({})
                    }}
                  />
                </div>
              </div>
              {profile && (
                <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm">
                  <p className="font-semibold">
                    排程日：{profile.first_day_context.date} ·{' '}
                    {profile.first_day_context.timezone}
                  </p>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-slate-500">
                        该人首日可用时间（四条件共享）
                      </p>
                      <TimeWindows
                        windows={profile.first_day_context.availability}
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-slate-500">
                        该人首日固定事项（另保留素材午休及休息）
                      </p>
                      <TimeWindows
                        windows={profile.first_day_context.fixed_events}
                      />
                    </div>
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-indigo-700">
                      查看实际 Profile 字段及缺失维度
                    </summary>
                    <Json
                      value={{
                        fields: profile.original_profile_fields,
                        mapping: profile.part_a_dimension_mapping,
                      }}
                    />
                  </details>
                </div>
              )}
              <p className="mt-4 text-sm text-slate-500">
                可修改本次任务时长与当天截止时间，四条件共用；原素材不变。修改后请重新预览。难度由研究者填写，③④使用完全相同的值。分数越高表示主观越难。
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-3">任务 / 交付物</th>
                      <th className="w-48 p-3">优先级 / 当天截止</th>
                      <th className="w-32 p-3">分钟</th>
                      <th className="w-64 p-3">
                        难度 ·{' '}
                        {mode === 'level'
                          ? '等级'
                          : mode === 'score'
                            ? '0–100'
                            : '主观感受'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenario?.tasks.map((t) => (
                      <tr key={t.task_id} className="border-t border-slate-100">
                        <td className="p-3">
                          <p className="font-medium">{t.title}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {t.deliverable}
                          </p>
                        </td>
                        <td className="p-3">
                          <p className="mb-2">优先级：{t.priority}</p>
                          <input
                            aria-label={t.title + '截止时间'}
                            className={inputClass}
                            type="time"
                            step="60"
                            min={t.earliest_start}
                            max="23:59"
                            disabled={busy}
                            value={deadlines[t.task_id] ?? t.deadline}
                            onChange={(e) => {
                              invalidate()
                              setDeadlines({ ...deadlines, [t.task_id]: e.target.value })
                            }}
                          />
                          <p className="mt-1 text-xs text-slate-500">原截止 {t.deadline} · 最早开始 {t.earliest_start}</p>
                        </td>
                        <td className="p-3">
                          <input
                            aria-label={t.title + '时长'}
                            className={inputClass}
                            type="number"
                            step="1"
                            min={t.minimum_chunk_minutes}
                            max={1440}
                            disabled={busy}
                            value={durations[t.task_id] ?? t.estimated_minutes}
                            onChange={(e) => {
                              invalidate()
                              setDurations({
                                ...durations,
                                [t.task_id]: e.target.value,
                              })
                            }}
                          />
                        </td>
                        <td className="p-3">
                          {mode === 'level' ? (
                            <ChoicePicker
                              label={t.title + '难度'}
                              disabled={busy}
                              value={values[t.task_id] || ''}
                              options={[
                                { value: '', label: '请选择' },
                                { value: 'high', label: '高' },
                                { value: 'medium', label: '中' },
                                { value: 'low', label: '低' },
                              ]}
                              onChange={(value) => {
                                invalidate()
                                setValues({ ...values, [t.task_id]: value })
                              }}
                            />
                          ) : (
                            <input
                              aria-label={t.title + '难度'}
                              className={inputClass}
                              disabled={busy}
                              type={mode === 'score' ? 'number' : 'text'}
                              min={0}
                              max={100}
                              step="1"
                              maxLength={500}
                              placeholder={
                                mode === 'score'
                                  ? '0–100'
                                  : '例如：熟悉概念，但推导费力'
                              }
                              value={values[t.task_id] || ''}
                              onChange={(e) => {
                                invalidate()
                                setValues({
                                  ...values,
                                  [t.task_id]: e.target.value,
                                })
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-4">
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void inspect()}
                >
                  {busy ? '正在处理…' : '检查时间并预览提示词（不调用模型）'}
                </button>
                <span className="text-xs text-slate-500">
                  {catalog.model} · {catalog.policy}
                </span>
              </div>
            </section>
            {preview && (
              <section className="rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-lg font-semibold">
                  2. 核对提示词与共同约束
                </h2>
                <div
                  className={
                    'my-4 rounded-xl p-4 text-sm ' +
                    (preview.precheck.can_attempt
                      ? 'bg-emerald-50 text-emerald-900'
                      : 'bg-amber-50 text-amber-900')
                  }
                >
                  <p>
                    任务 {preview.precheck.work_minutes} 分钟 ·
                    扣除固定事项后可用 {preview.precheck.net_available_minutes}{' '}
                    分钟
                  </p>
                  {preview.precheck.issues.map((x) => (
                    <p className="mt-2" key={x}>
                      {x}
                    </p>
                  ))}
                  <p className="mt-2">{preview.precheck.note}</p>
                </div>
                <ul className="mb-4 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-500">
                  {preview.warnings.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <div className="grid gap-3 md:grid-cols-2">
                  {preview.conditions.map((c, i) => (
                    <details
                      key={c.id}
                      className="rounded-xl border border-slate-200 p-4"
                    >
                      <summary className="cursor-pointer font-medium">
                        {i + 1}. {c.label} · 完整初次请求
                      </summary>
                      <div className="mt-3">
                        <Json
                          value={{
                            model: preview.model,
                            ...preview.parameters,
                            messages: c.messages,
                          }}
                        />
                      </div>
                    </details>
                  ))}
                </div>
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-indigo-700">
                    完整共同时间与任务上下文
                  </summary>
                  <Json value={preview.common} />
                </details>
                {!preview.precheck.can_attempt && (
                  <div className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
                    <p className="font-medium">暂不能生成：时间预检未通过</p>
                    {preview.precheck.issues.map((issue) => <p key={issue} className="mt-1">{issue}</p>)}
                    <p className="mt-1">请核对任务时长或截止时间，修改后重新预览。</p>
                  </div>
                )}
                <button
                  className="mt-5 rounded-lg bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
                  disabled={busy || active || !preview.precheck.can_attempt}
                  onClick={() => void generate()}
                >
                  {active ? '当前比较仍在生成' : '确认配置并调用模型生成'}
                </button>
              </section>
            )}
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">3. 生成记录与比较</h2>
                <div className="flex min-w-0 max-w-full flex-wrap gap-2">
                  <ChoicePicker
                    label="历史记录"
                    className="sm:!w-[26rem] max-w-full"
                    value={run?.id || ''}
                    placeholder="选择保存的比较"
                    disabled={busy || !history.length}
                    options={history.map((h) => ({
                      value: h.id,
                      label: `${h.created_at.slice(0, 16).replace('T', ' ')} UTC · ${h.profile_id} / ${h.scenario_id} · ${stateNames[h.status] || h.status}`,
                    }))}
                    onChange={(id) => void selectRun(id)}
                  />
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() => void refreshHistory()}
                  >
                    刷新记录
                  </button>
                  {run && (
                    <button
                      className={buttonClass}
                      onClick={() => exportRun(run)}
                    >
                      导出完整 JSON
                    </button>
                  )}
                </div>
              </div>
              {!run ? (
                <p className="mt-6 text-sm text-slate-500">
                  尚未启动本次比较。请先自主配置并预览提示词，再点击生成。已有记录仅在你从“历史记录”中选择后显示，刷新页面不会自动加载旧结果。
                </p>
              ) : (
                <>
                  <div className="my-4 rounded-xl bg-slate-50 p-4 text-sm">
                    <p className="font-medium">
                      {run.profile_id} · {run.preview.scenario_title} ·{' '}
                      {run.preview.common.date} ·{' '}
                      {stateNames[run.status] || run.status}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      以下为所选记录的输入快照，不随上方修改变化。时间校验通过仅表示满足硬约束，不代表系统效果更好。记录{' '}
                      {run.id}；{run.preview.model}。
                    </p>
                  </div>
                  <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
                    {run.results.map((r, i) => (
                      <article
                        key={r.id}
                        className="min-w-0 rounded-xl border border-slate-200"
                      >
                        <div className="border-b border-slate-100 p-4">
                          <h3 className="font-semibold">
                            {i + 1}. {r.label}
                          </h3>
                          <p
                            className={
                              'mt-2 text-sm ' +
                              (r.status === 'valid'
                                ? 'text-emerald-700'
                                : ['error', 'invalid', 'interrupted'].includes(
                                      r.status,
                                    )
                                  ? 'text-red-700'
                                  : 'text-indigo-600')
                            }
                            role="status"
                          >
                            {stateNames[r.status] || r.status} ·{' '}
                            {r.attempts.length}/3 次
                          </p>
                        </div>
                        <div className="space-y-4 p-4">
                          {r.error && (
                            <p className="text-sm text-red-700">{r.error}</p>
                          )}
                          {r.final?.blocks.map((b, j) => (
                            <div
                              key={j}
                              className="border-l-4 border-indigo-300 bg-indigo-50/60 px-3 py-2"
                            >
                              <p className="text-xs text-indigo-700">
                                {clock(b.start_at, run.preview.common.timezone)}
                                –{clock(b.end_at, run.preview.common.timezone)}{' '}
                                · {b.minutes} 分钟
                              </p>
                              <p className="mt-1 text-sm font-medium">
                                {b.title}
                              </p>
                            </div>
                          ))}
                          {r.explanation && (
                            <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
                              {r.explanation}
                            </p>
                          )}
                          {r.attempts.map((a) => (
                            <details
                              key={a.number}
                              className="rounded-lg border border-slate-200 p-3"
                            >
                              <summary className="cursor-pointer text-sm font-medium">
                                第 {a.number} 次 ·{' '}
                                {stateNames[a.status] || a.status}
                              </summary>
                              <div className="mt-3 space-y-3">
                                {a.validation && (
                                  <p className="text-xs leading-5 text-slate-600">
                                    {a.validation.valid
                                      ? '全部共同时间规则通过。'
                                      : a.validation.violations.join('；')}
                                  </p>
                                )}
                                <p className="text-xs font-semibold">
                                  {a.request
                                    ? '实际发送的完整请求体'
                                    : '已准备的消息（尚无发送回执）'}
                                </p>
                                <Json value={a.request || a.messages} />
                                <p className="text-xs font-semibold">
                                  原始模型内容
                                </p>
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-xs">
                                  {a.raw_content ||
                                    a.error ||
                                    (a.status === 'calling'
                                      ? '等待模型响应…'
                                      : '模型返回空内容（未产生可用JSON）。')}
                                </pre>
                                {a.usage != null && <Json value={a.usage} />}
                              </div>
                            </details>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
