'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type {
  Configuration,
  ParticipantProfile,
  SimBlock,
  SimDocument,
  SimRun,
} from '@/lib/contracts/simulation-contracts'
import {
  api,
  Button,
  Field,
  inputClass,
  mutation,
  Panel,
  stamp,
  starterQuestions,
  TimeInput,
} from './common'
import { QuestionEditor } from './question-editor'
import { QuestionForm } from './question-form'
import { SimulationCalendar } from './calendar'
import { SimulationGuide } from './guide'
import { ParticipantWorkspace } from './participant-workspace'
import { ProfileSetup, ProfileEditor } from './profile'
import { ParticipantSetup } from './participant-setup'
import { AccountSetup } from './account-setup'
import { SimulationSignOut } from './sign-out'
import { SimulationTour, START_SIMULATION_TOUR } from './tour'

type Caps = {
  role: 'researcher' | 'participant'
  enabled: boolean
  user_id: string
}
type Summary = {
  mode?: 'live' | 'simulation'
  id: string
  name: string
  status: string
  participant_id: string
  simulated_at: string
}
const base = '/app/simulation'
const statusText: Record<string, string> = {
  setup: '等待初始填写',
  ready: '等待生成与确认',
  active: '进行中',
  awaiting_final: '等待结束评价',
  completed: '已完成',
}

export function SimulationApp({ path }: { path: string[] }) {
  const [caps, setCaps] = useState<Caps | null>(null),
    [error, setError] = useState('')
  const load = useCallback(() => {
    setError('')
    api<Caps>('capabilities')
      .then(setCaps)
      .catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])
  const research = path[0] === 'research'
  const section = path[research ? 1 : 0],
    id = path[research ? 2 : 1]
  if (error)
    return (
      <div className="p-8">
        <p role="alert" className="mb-4 text-rose-700">
          {error}
        </p>
        <Button onClick={load}>重试连接</Button>
      </div>
    )
  if (!caps) return <p className="p-8 text-slate-500">正在检查模拟权限…</p>
  if (research && caps.role !== 'researcher')
    return (
      <p role="alert" className="p-8">
        此账号没有研究者权限。
        <Link className="ml-3 underline" href={base}>
          返回我的会话
        </Link>
      </p>
    )
  if (!research)
    return (
      <ParticipantEntry
        caps={caps}
        requestedId={section === 'runs' ? id : undefined}
      />
    )
  return (
    <main
      data-simulation-app
      className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-8"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-indigo-600">
            HUMANOS · AI INQUIRY CONTROL
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {research ? '研究者控制台' : '我的工作台'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href={base + '/research/profile'}>Profile 字段</Link>
          <SimulationSignOut />
          {caps.role === 'researcher' && (
            <>
              <Link href={base + '/research'}>研究者入口</Link>
            </>
          )}
          <button
            type="button"
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 font-medium text-indigo-700"
            onClick={() =>
              window.dispatchEvent(new Event(START_SIMULATION_TOUR))
            }
          >
            ↖ 操作引导
          </button>
        </div>
      </header>
      {section === 'scenarios' ? (
        <Panel title="旧场景功能已移除">
          <p>
            请由参与者自行填写任务与时间。研究者可编辑问题方案并启停 AI 节点。
          </p>
          <Link href={base + '/research'} className="text-indigo-700 underline">
            返回控制台
          </Link>
        </Panel>
      ) : research && section === 'profile' ? (
        <ProfileEditor userId={caps.user_id} />
      ) : research && section === 'guide' ? (
        <SimulationGuide />
      ) : section === 'runs' && id ? (
        <RunView
          key={id + research}
          id={id}
          research={research}
          userId={caps.user_id}
        />
      ) : research && section === 'configs' && id ? (
        <Editor
          key={section + id}
          kind={section}
          id={id}
          userId={caps.user_id}
        />
      ) : (
        <Lobby research={research} caps={caps} />
      )}
    </main>
  )
}

function ParticipantEntry({
  caps,
  requestedId,
}: {
  caps: Caps
  requestedId?: string
}) {
  const [profile, setProfile] = useState<ParticipantProfile | null>(null)
  const [profileError, setProfileError] = useState('')
  const loadProfile = useCallback(() => {
    setProfileError('')
    api<ParticipantProfile>('profile')
      .then(setProfile)
      .catch((e) => setProfileError(e.message))
  }, [])
  useEffect(loadProfile, [loadProfile])
  const [runs, setRuns] = useState<Summary[]>([])
  const [selected, setSelected] = useState(requestedId || '')
  const [setupOpen, setSetupOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const initialized = useRef(false)
  const load = useCallback(async () => {
    try {
      const response = await api<{ runs: Summary[] }>('runs')
      const own = response.runs.filter(
        (r) => r.participant_id === caps.user_id && r.mode === 'live',
      )
      setRuns(own)
      if (!initialized.current) {
        const desired =
          requestedId ||
          new URLSearchParams(window.location.search).get('run') ||
          ''
        setSelected(
          desired ||
            own.find((r) => r.status !== 'completed')?.id ||
            own[0]?.id ||
            '',
        )
        initialized.current = true
      } else {
        setSelected(
          (current) =>
            current ||
            own.find((r) => r.status !== 'completed')?.id ||
            own[0]?.id ||
            '',
        )
      }
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [caps.user_id, requestedId])
  useEffect(() => {
    void load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])
  const selector = (
    <div className="flex items-center gap-2 text-xs">
      {runs.length > 1 && (
        <label>
          工作记录{' '}
          <select
            aria-label="选择工作记录"
            className="max-w-[180px] rounded border bg-background p-1"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value)
              const url = new URL(window.location.href)
              url.pathname = '/app'
              url.searchParams.set('run', e.target.value)
              window.history.replaceState(window.history.state, '', url)
            }}
          >
            <option value="" disabled>
              选择工作记录
            </option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {statusText[r.status] || r.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <button
          className="text-rose-700 underline"
          title={error}
          onClick={() => void load()}
        >
          工作记录读取失败，重试
        </button>
      )}
    </div>
  )
  if (!profile)
    return (
      <div className="p-8">
        <p role={profileError ? 'alert' : 'status'}>
          {profileError || '正在读取 Profile…'}
        </p>
        {profileError && <Button onClick={loadProfile}>重新读取</Button>}
        <SimulationSignOut />
      </div>
    )
  if (!profile.submitted_at)
    return (
      <ProfileSetup
        profile={profile}
        onSaved={setProfile}
        userId={caps.user_id}
      />
    )
  if (selected && !setupOpen)
    return (
      <RunView
        key={selected}
        id={selected}
        research={false}
        profile={profile}
        userId={caps.user_id}
        selector={selector}
      />
    )
  return (
    <AccountSetup
      userId={caps.user_id}
      onWorkspaceReady={(id) => {
        setSelected(id)
        setSetupOpen(false)
        void load()
      }}
      onCompleted={() => setSetupOpen(false)}
      onEditing={() => setSetupOpen(true)}
      onProfileSaved={setProfile}
    />
  )
}

function Lobby({ research, caps }: { research: boolean; caps: Caps }) {
  const [runs, setRuns] = useState<Summary[]>([]),
    [configs, setConfigs] = useState<SimDocument<Configuration>[]>([])
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const load = useCallback(async () => {
    try {
      const r = await api<{ runs: Summary[] }>('runs')
      setRuns(
        research
          ? r.runs
          : r.runs.filter((run) => run.participant_id === caps.user_id),
      )
      if (research) {
        const c = await api<{ documents: SimDocument<Configuration>[] }>(
          'configs',
        )
        setConfigs(c.documents)
      }
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [research, caps.user_id])
  useEffect(() => {
    void load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [load])
  return (
    <>
      <SimulationTour
        scope={research ? 'research-lobby' : 'participant-lobby'}
        userId={caps.user_id}
        ready={!loading && !error}
      />
      <p data-tour="account-id" className="text-sm text-slate-500">
        我的账号编号：<code className="select-all">{caps.user_id}</code>
      </p>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}{' '}
          <button className="underline" onClick={() => void load()}>
            重试
          </button>
        </p>
      )}
      {research && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="原 Profile 字段">
              <Link
                data-tour="edit-profile"
                href={base + '/research/profile'}
                className="text-indigo-700 underline"
              >
                编辑原首次填写字段
              </Link>
              <p className="mt-3 text-sm text-slate-500">
                保留身份、学习方式、计划受阻原因、任务安排偏好、专注与休息、早中晚精力。参与者先填写
                Profile 后可继续填写自己的任务与时间，可直接进入工作台。
              </p>
            </Panel>
            <Panel title="过程询问与评价方案">
              <Link
                className="text-indigo-700 underline"
                data-tour="new-config"
                href={base + '/research/configs/new'}
              >
                ＋ 新建问题方案
              </Link>
              <div className="mt-4 space-y-3">
                {configs.map((c) => (
                  <Link
                    key={c.id}
                    className="block rounded-lg border p-3"
                    href={base + '/research/configs/' + c.id}
                  >
                    {c.content.name}
                    <span className="ml-3 text-xs text-slate-500">
                      {c.latest_version_id ? '已有发布版' : '草稿'}
                    </span>
                  </Link>
                ))}
              </div>
            </Panel>
          </div>
          <Panel title="工作台与询问节点">
            <p className="text-sm text-slate-600">
              用户完成首次设置后直接使用自己的工作台，无需分配场景。AI
              根据任务、状态和反馈生成询问时间节点；研究者进入工作台记录，只决定是否启用节点。启用后由服务器在到时自动判断是否需要提问。
            </p>
          </Panel>
        </>
      )}
      <Panel
        tourId="run-list"
        title={research ? '用户工作台与历史记录' : '我的工作台'}
      >
        {loading ? (
          <p>正在加载…</p>
        ) : !runs.length ? (
          <p className="text-slate-500">
            暂时没有工作台记录。用户完成首次设置并进入后，会自动出现在这里。
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {runs.map((r) => (
              <Link
                key={r.id}
                href={base + (research ? '/research' : '') + '/runs/' + r.id}
                className="rounded-xl border p-4 hover:border-indigo-400"
              >
                <strong>{r.name}</strong>
                <p className="mt-2 text-sm text-slate-500">
                  {r.mode !== 'live' ? '旧版记录（只读） · ' : ''}
                  {statusText[r.status] || r.status}
                </p>
                {research && (
                  <p className="mt-1 break-all text-xs text-slate-500">
                    参与者 {r.participant_id}
                  </p>
                )}
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </>
  )
}

function Editor({
  kind,
  id,
  userId,
}: {
  kind: 'configs'
  id: string
  userId: string
}) {
  const [doc, setDoc] = useState<SimDocument<Configuration> | null>(null)
  const [value, setValue] = useState<Configuration | null>(null),
    [dirty, setDirty] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false)
  const router = useRouter()
  useEffect(() => {
    if (id === 'new') {
      setValue({ name: '新的问题方案', questions: starterQuestions() })
      setDirty(true)
    } else
      api<SimDocument<Configuration>>(kind + '/' + id)
        .then((d) => {
          setDoc(d)
          setValue(d.content)
        })
        .catch((e) => setError(e.message))
  }, [kind, id])
  async function save(publish = false) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      let d = doc
      if (dirty || !d)
        d = await api<SimDocument<Configuration>>(
          kind + (d ? '/' + d.id : ''),
          d ? 'PATCH' : 'POST',
          mutation({ content: value, expected_revision: d?.revision }),
        )
      if (publish)
        d = await api<SimDocument<Configuration>>(
          kind + '/' + d!.id + '/publish',
          'POST',
          mutation({ expected_revision: d!.revision }),
        )
      setDoc(d)
      setValue(d!.content)
      setDirty(false)
      setNotice(
        publish
          ? '已发布新版本。已有工作台仍使用原版本；请在对应工作台中明确切换。发布不会立即调用模型或改写已填写的答案。'
          : '草稿已保存，尚未发布；正在使用的题目不会改变。',
      )
      if (id === 'new') router.replace(base + '/research/' + kind + '/' + d!.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SimulationTour
        scope={`${kind}-editor`}
        userId={userId}
        ready={!!value}
      />
      <Link
        data-tour="editor-back"
        className="text-sm text-indigo-700"
        href={base + '/research'}
      >
        ← 返回控制台
      </Link>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4 shadow-sm">
        <Button
          tourId="editor-save"
          disabled={busy || !value}
          onClick={() => void save()}
        >
          保存草稿
        </Button>
        <Button
          tourId="editor-publish"
          disabled={busy || !value}
          onClick={() => void save(true)}
        >
          保存并发布版本
        </Button>
        <Button
          tourId="editor-preview"
          secondary
          onClick={() => setPreview(!preview)}
        >
          {preview ? '继续编辑' : '预览表单'}
        </Button>
        <span className="text-sm text-slate-500">
          {busy ? '正在保存…' : dirty ? '有未保存修改' : '已保存'}
        </span>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-700">
          {notice}
        </p>
      )}
      {!value ? (
        <p>正在加载方案…</p>
      ) : preview ? (
        <Panel title="参与者表单预览（不会保存答案）">
          <QuestionForm
            key={JSON.stringify(value)}
            preview
            busy={false}
            batch={{
              id: 'preview',
              phase: 'preview',
              created_at: '',
              questions: (value as Configuration).questions.filter(
                (q) => q.enabled,
              ),
            }}
            onSubmit={async () => {}}
          />
        </Panel>
      ) : (
        <QuestionEditor
          value={value as Configuration}
          onChange={(v) => {
            setValue(v)
            setDirty(true)
          }}
        />
      )}
      {doc?.latest_version_id && (
        <p className="break-all text-xs text-slate-500">
          最新发布版本：{doc.latest_version_id}
        </p>
      )}
    </>
  )
}

function RunView({
  profile,
  id,
  research,
  userId,
  selector,
}: {
  id: string
  profile?: ParticipantProfile
  research: boolean
  userId: string
  selector?: ReactNode
}) {
  const [editedProfile, setEditedProfile] = useState<ParticipantProfile>()
  const answerDrafts = useRef<Record<string, Record<string, unknown>>>({})
  const [run, setRun] = useState<SimRun | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<SimBlock[] | undefined>(),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false)
  const [overrideReason, setOverrideReason] = useState(''),
    [switchVersion, setSwitchVersion] = useState(''),
    [showActive, setShowActive] = useState(false)
  const [askOpen, setAskOpen] = useState(true)
  const [configurationNotice, setConfigurationNotice] = useState('')
  const [progress, setProgress] = useState<Record<string, string>>({})
  const last = useRef({ plan: '', batch: '' })
  const latestRevision = useRef(0)
  const load = useCallback(async () => {
    try {
      const r = await api<SimRun>('runs/' + id)
      if (r.revision < latestRevision.current) return
      latestRevision.current = r.revision
      if (last.current.plan !== (r.proposed_plan?.id || '')) {
        setDraft(undefined)
        setReason('')
        setAck(false)
        setShowActive(false)
      }
      if (last.current.batch !== (r.pending_batch?.id || '')) setAskOpen(true)
      last.current = {
        plan: r.proposed_plan?.id || '',
        batch: r.pending_batch?.id || '',
      }
      setRun(r)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])
  useEffect(() => {
    void load()
    const timer = setInterval(load, 2500)
    const visible = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [load])
  async function act(path: string, body: Record<string, unknown> = {}) {
    if (!run) return
    setBusy(true)
    setError('')
    setConfigurationNotice('')
    try {
      await api(
        'runs/' + id + '/' + path,
        'POST',
        mutation({ expected_revision: run.revision, ...body }),
      )
      if (path === 'configuration-switch') {
        setConfigurationNotice(
          '问题版本已切换，旧候选节点已清空。下一次模型调用采用新配置；此次切换不会立即调用模型，历史答案保留原题目和版本。',
        )
      }
      await load()
    } catch (e) {
      setError((e as Error).message)
      await load()
      throw e
    } finally {
      setBusy(false)
    }
  }
  const click = (path: string, body?: Record<string, unknown>) => {
    void act(path, body).catch(() => {})
  }
  if (!run && !research)
    return (
      <div className="min-h-dvh bg-background p-8">
        <p role={error ? 'alert' : 'status'}>
          {error || '正在读取已保存的填写进度…'}
        </p>
        {error && <Button onClick={() => void load()}>重新读取</Button>}
      </div>
    )
  if (!run)
    return (
      <Panel>
        <p>{error || '正在加载模拟会话…'}</p>
        <Button secondary onClick={() => void load()}>
          重新加载
        </Button>
      </Panel>
    )
  if (run.mode !== 'live')
    return (
      <div className="space-y-4 p-4">
        <Panel title="旧版记录（只读）">
          <p>
            {run.scenario.name} · {statusText[run.status] || run.status}
          </p>
          <p className="my-3">
            旧场景功能已移除。本轮记录保留，不能再分配场景、推进时间或提交修改。
          </p>
          <p>
            {run.scenario.start_at} — {run.scenario.end_at} ·{' '}
            {run.scenario.tasks.length} 个任务
          </p>
          <Link
            className="text-indigo-700 underline"
            href={research ? base + '/research' : '/app'}
          >
            返回工作台
          </Link>
        </Panel>
        {error && <p role="alert">{error}</p>}
        {research && <RunExport run={run} id={id} onError={setError} />}
      </div>
    )
  const waiting = busy || !!run.pending_job_id
  const lastNodeGeneration = run.node_versions
    ?.filter((version) => version.source === 'ai')
    .slice(-1)[0]
  const nodeUpdateAt =
    typeof lastNodeGeneration?.at === 'string' ? lastNodeGeneration.at : null
  const zone = run.scenario.timezone
  const ready =
    !waiting &&
    !run.pending_batch &&
    !run.proposed_plan &&
    run.status !== 'completed' &&
    run.status !== 'awaiting_final'
  const form = run.pending_batch && (
    <QuestionForm
      key={run.pending_batch.id}
      batch={run.pending_batch}
      initialValues={answerDrafts.current[run.pending_batch.id] || {}}
      onValuesChange={(values) => {
        answerDrafts.current[run.pending_batch!.id] = values
      }}
      submitLabel={
        !run.initial_submitted ? '保存状态并生成我的计划' : '提交回答'
      }
      busy={waiting}
      onPresented={async () => {
        if (run.pending_batch?.first_presented_at) return
        try {
          await api(
            'runs/' + id + '/presented',
            'POST',
            mutation({
              batch_id: run.pending_batch!.id,
              expected_revision: run.revision,
            }),
          )
          await load()
        } catch (e) {
          setError('展示时间未记录：' + (e as Error).message)
          throw e
        }
      }}
      onSubmit={(answers) =>
        act('answers', { batch_id: run.pending_batch!.id, answers })
      }
    />
  )
  const participantTour =
    run.status === 'completed'
      ? 'completed'
      : run.pending_batch
        ? run.pending_batch.phase === 'node'
          ? 'node'
          : run.pending_batch.phase === 'final'
            ? 'final'
            : run.pending_batch.phase === 'profile'
              ? 'profile'
              : 'feedback'
        : run.pending_job_id
          ? 'waiting'
          : error || run.error
            ? 'error'
            : run.proposed_plan
              ? 'review'
              : run.active_plan
                ? 'active'
                : 'ready'
  const calendarRun = showActive ? { ...run, proposed_plan: null } : run
  if (
    !research &&
    (run.participant_setup_complete === false || !run.initial_submitted)
  )
    return (
      <ParticipantSetup
        run={run}
        userId={userId}
        busy={waiting}
        error={error}
        form={form}
        onAction={act}
        onProfileSaved={setEditedProfile}
      />
    )
  if (!research)
    return (
      <ParticipantWorkspace
        run={run}
        profile={editedProfile || profile}
        userId={userId}
        selector={selector}
        form={form}
        error={error}
        busy={busy}
        onRefresh={() => void load()}
        onAction={act}
      />
    )
  return (
    <>
      <SimulationTour
        scope={research ? 'research-run' : `participant-${participantTour}`}
        userId={userId}
      />
      <Link
        className="text-sm text-indigo-700"
        href={base + (research ? '/research' : '')}
      >
        ← 返回会话列表
      </Link>
      <Panel tourId="run-summary">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">{run.scenario.name}</h2>
            <p className="mt-2 text-sm text-slate-500">
              {run.scenario.description}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl tabular-nums">
              {stamp(run.simulated_at, zone)}
            </p>
            <p className="text-xs text-slate-500">
              当前时间 · {zone} · {statusText[run.status]}
            </p>
          </div>
        </div>
      </Panel>
      {(error || run.error) && (
        <div
          role="alert"
          data-tour="run-error"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800"
        >
          {error || run.error}
          <p className="mt-1 text-sm">已确认的计划保留。请检查提示后重试。</p>
          <button
            className="mt-2 underline"
            onClick={() => {
              setError('')
              void load()
            }}
          >
            刷新状态
          </button>
        </div>
      )}
      {run.pending_job_id && (
        <p
          role="status"
          data-tour="model-waiting"
          className="rounded-xl bg-indigo-50 p-4 text-indigo-800"
        >
          AI 正在判断安排和后续询问节点，请稍候。刷新页面不会丢失进度。
        </p>
      )}
      {run.revealed_events.length > 0 && (
        <Panel title="当前情境">
          <strong>{run.revealed_events.at(-1)?.title}</strong>
          <p className="mt-2 whitespace-pre-wrap text-slate-600">
            {run.revealed_events.at(-1)?.description}
          </p>
        </Panel>
      )}
      {!research && run.pending_batch && run.pending_batch.phase !== 'node' && (
        <Panel
          title={
            run.pending_batch.phase === 'profile'
              ? '开始前，了解你的情况'
              : run.pending_batch.phase === 'final'
                ? '体验评价'
                : '填写反馈'
          }
        >
          {form}
        </Panel>
      )}
      {!research && run.pending_batch?.phase === 'node' && (
        <>
          <Button tourId="answer-open" onClick={() => setAskOpen(true)}>
            回答当前问题
          </Button>
          {askOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
              role="dialog"
              aria-modal="true"
              aria-label="了解当前情况"
            >
              <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
                <div className="mb-5 flex justify-between">
                  <h2 className="text-xl font-semibold">了解一下当前情况</h2>
                  <button
                    onClick={() => setAskOpen(false)}
                    aria-label="暂时收起问题"
                  >
                    ×
                  </button>
                </div>
                {form}
              </div>
            </div>
          )}
        </>
      )}
      <div
        className={`grid gap-5 ${research ? 'xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]' : ''}`}
      >
        <div className="min-w-0 space-y-5">
          <Panel
            tourId="run-calendar"
            title={
              showActive
                ? '已确认日历'
                : run.proposed_plan
                  ? '待审核的计划建议'
                  : '已确认日历'
            }
          >
            {run.proposed_plan && (
              <div className="mb-4 flex gap-2">
                <Button secondary onClick={() => setShowActive(false)}>
                  查看建议
                </Button>
                <Button secondary onClick={() => setShowActive(true)}>
                  查看当前已确认计划
                </Button>
              </div>
            )}
            {!run.active_plan && !run.proposed_plan && (
              <p className="mb-4 text-slate-500">
                尚无已确认计划。完成初始信息后生成建议。
              </p>
            )}
            <SimulationCalendar
              run={calendarRun}
              draft={!showActive ? draft : undefined}
              onEdit={
                !research &&
                !showActive &&
                run.proposed_plan &&
                !waiting &&
                !run.pending_batch
                  ? setDraft
                  : undefined
              }
            />
            {draft && (
              <p className="mt-3 text-sm text-amber-800">
                拖动修改尚未保存，请点击下方“确认修改”。后端验证通过后才会更新计划。
              </p>
            )}
          </Panel>
          {!research && run.proposed_plan && (
            <Panel tourId="review-panel" title="审核安排">
              <p className="whitespace-pre-wrap text-sm text-slate-600">
                {run.proposed_plan.explanation}
              </p>
              {run.proposed_plan.unscheduled.length > 0 && (
                <div className="my-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  <p>以下工作量尚未安排：</p>
                  {run.proposed_plan.unscheduled.map((t) => (
                    <p key={t.task_id}>
                      {t.title}：{t.minutes}分钟
                    </p>
                  ))}
                </div>
              )}
              <label className="my-4 block text-sm">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />{' '}
                若仍有未安排的工作量，我确认保留待安排状态
              </label>
              <Field label="原因或补充说明（可选）">
                <textarea
                  className={inputClass}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  tourId="review-accept"
                  disabled={waiting || !!run.pending_batch}
                  onClick={() =>
                    click('plans/' + run.proposed_plan!.id + '/review', {
                      response: draft ? 'modify' : 'accept',
                      edits: draft,
                      reason,
                      acknowledge_unscheduled: ack,
                    })
                  }
                >
                  {draft ? '确认修改' : '接受并保存'}
                </Button>
                <Button
                  secondary
                  tourId="review-reject"
                  disabled={waiting || !!run.pending_batch}
                  onClick={() =>
                    click('plans/' + run.proposed_plan!.id + '/review', {
                      response: 'reject',
                      reason,
                    })
                  }
                >
                  拒绝建议
                </Button>
                {draft && (
                  <Button secondary onClick={() => setDraft(undefined)}>
                    还原拖动
                  </Button>
                )}
              </div>
            </Panel>
          )}
          {ready && !research && (
            <Button
              tourId="generate"
              disabled={!run.initial_submitted}
              onClick={() => click('generate')}
            >
              {run.error
                ? '重试生成'
                : run.active_plan
                  ? '请求重新评估'
                  : '生成初始计划'}
            </Button>
          )}
          {!research && ready && run.active_plan && (
            <Button
              tourId="check-in"
              secondary
              onClick={() => click('check-in')}
            >
              报告新的状态或情况
            </Button>
          )}
          {!research && run.active_plan && (
            <Panel tourId="progress-panel" title="报告任务进展">
              <p className="mb-3 text-sm text-slate-500">
                填写发生变化的任务剩余分钟数。完成填
                0；留空表示没有更新。提交后系统会重新评估安排。
              </p>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  const values = Object.fromEntries(
                    Object.entries(progress)
                      .filter(([, v]) => v !== '')
                      .map(([k, v]) => [k, Number(v)]),
                  )
                  void act('progress', { remaining_minutes: values })
                    .then(() => setProgress({}))
                    .catch(() => {})
                }}
              >
                {run.scenario.tasks.map((t) => (
                  <Field
                    key={t.id}
                    label={`${t.title} · 当前剩余 ${run.remaining[t.id]} 分钟`}
                  >
                    <input
                      type="number"
                      min={0}
                      max={14400}
                      step={1}
                      className={inputClass}
                      value={progress[t.id] || ''}
                      data-help="填写此任务还需要的分钟数，完成填 0；留空表示不更新。保存进展后提交。"
                      placeholder="没有更新"
                      onChange={(e) =>
                        setProgress({ ...progress, [t.id]: e.target.value })
                      }
                    />
                  </Field>
                ))}
                <Button
                  disabled={
                    !ready || !Object.values(progress).some((v) => v !== '')
                  }
                  type="submit"
                >
                  保存进展并重新评估
                </Button>
              </form>
            </Panel>
          )}
          {run.status === 'completed' && (
            <p
              role="status"
              data-tour="run-completed"
              className="rounded-xl bg-emerald-50 p-5 text-emerald-900"
            >
              本次模拟已完成，回答与选择均已保存。
            </p>
          )}
        </div>
        {research && (
          <div className="space-y-5">
            <Panel title="会话控制">
              <p data-tour="participant-link" className="mb-3 text-sm">
                参与者链接：
                <Link
                  className="break-all text-indigo-700 underline"
                  href={'/app?run=' + id}
                >
                  {'/app?run=' + id}
                </Link>
              </p>
              <p className="text-sm text-slate-600">
                本次模拟使用服务器时间。研究者只启用／停用 AI
                返回的节点，不能调整时间或立即触发。
              </p>
              {run.pending_batch && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">
                  等待参与者填写：
                  {run.pending_batch.questions.map((q) => q.title).join('；')}
                </p>
              )}
              {run.proposed_plan && (
                <p className="mt-3 text-sm text-amber-800">
                  等待参与者审核候选计划。
                </p>
              )}
            </Panel>
            {run.participant_setup_complete === false && (
              <p
                role="status"
                className="rounded-lg bg-amber-50 p-4 text-amber-900"
              >
                等待参与者填写自己的任务与可用时间。研究者无需代填，完成后再进行安排与节点判断。
              </p>
            )}
            <Panel tourId="candidate-nodes" title="询问节点（研究者控制）">
              <p className="mb-3 text-sm text-slate-600">
                AI
                决定候选节点的时间；研究者只控制是否启用。启用节点到时，服务器结合最新任务和回答判断是否询问、问哪些题，也可以跳过或推迟。每次回答后重新评估后续节点。
              </p>
              <div
                data-tour="node-approval-policy"
                className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
              >
                <p>
                  重新生成会替换原候选节点。新节点默认关闭，不继承上一次生成的启用状态，需要重新审核并启用。
                </p>
                <p className="mt-2">
                  当前候选：{run.candidate_nodes?.length || 0}{' '}
                  个；已启用待触发：
                  {run.candidate_nodes?.filter(
                    (node) => node.enabled && !node.triggered_at,
                  ).length || 0}{' '}
                  个。
                </p>
                <p className="mt-1">
                  {nodeUpdateAt
                    ? `最近一次 AI 更新：${stamp(nodeUpdateAt, zone)}`
                    : '尚无 AI 节点生成时间记录。'}
                </p>
              </div>
              {run.last_inquiry_decision && (
                <p className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
                  上次系统判断：
                  {
                    { ask: '需要询问', skip: '跳过询问', defer: '推迟询问' }[
                      run.last_inquiry_decision.decision
                    ]
                  }{' '}
                  · {run.last_inquiry_decision.reason}
                </p>
              )}
              <div className="mt-4 space-y-3">
                {run.candidate_nodes?.map((n) => {
                  const controlDisabled =
                    waiting ||
                    !!run.pending_batch ||
                    run.status === 'completed' ||
                    run.status === 'awaiting_final'
                  return (
                    <div key={n.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <strong>{n.title}</strong>
                        <label className="text-sm">
                          <input
                            type="checkbox"
                            data-help="启用或停用这个候选询问节点，操作会立即保存。到达启用节点时，服务器自动判断询问、跳过或推迟；无需研究者手动触发。"
                            checked={!!n.enabled}
                            disabled={controlDisabled || !!n.triggered_at}
                            onChange={(e) =>
                              click('nodes/' + n.id + '/override', {
                                action: e.target.checked ? 'enable' : 'disable',
                              })
                            }
                          />{' '}
                          {n.triggered_at
                            ? '已触发判断'
                            : n.enabled
                              ? '已启用'
                              : '未启用'}
                        </label>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        建议时刻：{stamp(n.at, zone)}
                      </p>
                      <p className="my-2 text-sm">{n.reason}</p>
                      <p className="mb-3 text-sm">
                        候选问题（到达后由系统重新判断）：
                        {n.question_ids
                          .map(
                            (q) =>
                              run.configuration?.questions.find(
                                (x) => x.question_id === q,
                              )?.title || q,
                          )
                          .join('；') || '没有可询问问题'}
                      </p>
                    </div>
                  )
                })}
                {!run.candidate_nodes?.length && (
                  <p className="text-sm text-slate-500">
                    当前没有候选询问节点。
                  </p>
                )}
              </div>
            </Panel>
            <Panel title="切换问题版本">
              <p
                className="mb-3 break-all text-sm"
                data-tour="active-question-version"
              >
                当前过程问题版本：{run.config_version_id || '未提供版本信息'}
              </p>
              <p className="mb-3 text-sm text-slate-600">
                发布新版不会自动切换本工作台。明确切换后，下一次模型调用使用新配置，旧候选节点清空；不会立即重新生成。Profile、首次设置和历史答案保留各自的表单快照。
              </p>
              {configurationNotice && (
                <p role="status" className="mb-3 text-sm text-emerald-700">
                  {configurationNotice}
                </p>
              )}
              {!ready && (
                <p className="mb-3 text-sm text-amber-800">
                  {waiting
                    ? '正在保存或调用模型，完成后才能切换。'
                    : run.pending_batch
                      ? '当前问题尚未完成，请等待参与者提交后再切换。'
                      : run.proposed_plan
                        ? '当前计划尚未审核，请等待参与者处理后再切换。'
                        : '本轮当前状态不允许切换问题版本。'}
                </p>
              )}
              <Field label="已发布问题版本ID">
                <input
                  className={inputClass}
                  value={switchVersion}
                  onChange={(e) => setSwitchVersion(e.target.value)}
                />
              </Field>
              <Field label="切换原因">
                <input
                  className={inputClass}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              </Field>
              <div className="mt-3">
                <Button
                  secondary
                  disabled={!ready || !switchVersion || !overrideReason}
                  onClick={() =>
                    click('configuration-switch', {
                      config_version_id: switchVersion,
                      reason: overrideReason,
                    })
                  }
                >
                  明确切换版本
                </Button>
              </div>
            </Panel>
          </div>
        )}
      </div>
      {research && <RunExport run={run} id={id} onError={setError} />}
    </>
  )
}

function RunExport({
  run,
  id,
  onError,
}: {
  run: SimRun
  id: string
  onError: (message: string) => void
}) {
  return (
    <Panel tourId="export-records" title="过程记录与导出">
      <Button
        secondary
        onClick={() => {
          void api<unknown>('runs/' + id + '/export')
            .then((data) => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], {
                  type: 'application/json',
                }),
              )
              const a = document.createElement('a')
              a.href = url
              a.download = id + '.json'
              a.click()
              URL.revokeObjectURL(url)
            })
            .catch((e) => onError(e.message))
        }}
      >
        导出完整 JSON
      </Button>
      <Button
        secondary
        onClick={() => {
          void api<{ filename: string; content: string }>(
            'runs/' + id + '/export?format=csv',
          )
            .then((data) => {
              const url = URL.createObjectURL(
                new Blob(['\ufeff' + data.content], {
                  type: 'text/csv;charset=utf-8',
                }),
              )
              const a = document.createElement('a')
              a.href = url
              a.download = data.filename
              a.click()
              URL.revokeObjectURL(url)
            })
            .catch((e) => onError(e.message))
        }}
      >
        导出 CSV
      </Button>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <details className="rounded-lg bg-slate-50 p-3">
          <summary>事件与研究者干预（{run.events?.length || 0}）</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(run.events, null, 2)}
          </pre>
        </details>
        <details className="rounded-lg bg-slate-50 p-3">
          <summary>
            模型调用、输入与验证（{run.jobs?.length || 0}次任务）
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(run.jobs, null, 2)}
          </pre>
        </details>
        <details className="rounded-lg bg-slate-50 p-3">
          <summary>询问计划历次变化</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(run.node_versions, null, 2)}
          </pre>
        </details>
      </div>
    </Panel>
  )
}
