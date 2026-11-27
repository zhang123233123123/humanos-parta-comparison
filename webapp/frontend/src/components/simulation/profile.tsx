'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type {
  Configuration,
  ParticipantProfile,
  ProfileFormVersion,
} from '@/lib/contracts/simulation-contracts'
import { api, mutation, Button, Panel } from './common'
import { ProfileFields } from './profile-fields'
import { Button as OnboardingButton } from '@/components/ui/button'
import { QuestionEditor } from './question-editor'
import { SimulationTour } from './tour'
import { OnboardingFrame } from './onboarding-frame'

const background = new Set([
  'role',
  'learning_mode',
  'planning_failure_reasons',
  'recent_plan_failure',
])
export function ProfileSetup({
  profile,
  onSaved,
  userId,
  initialStep,
  onCancel,
}: {
  profile: ParticipantProfile
  onSaved: (profile: ParticipantProfile) => void
  userId: string
  initialStep?: number
  onCancel?: () => void
}) {
  const [values, setValues] = useState(profile.values)
  const [step, setStep] = useState(initialStep ?? profile.step ?? 0)
  const [saved, setSaved] = useState(profile)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const questions = profile.form.content.questions.filter(
    (q) =>
      q.enabled &&
      (step === 0
        ? background.has(q.question_id)
        : !background.has(q.question_id)),
  )
  async function save() {
    if (profile.submitted_at && step === 0) {
      setStep(1)
      return
    }
    setBusy(true)
    setError('')
    try {
      const next = await api<ParticipantProfile>(
        'profile',
        'POST',
        mutation({
          expected_revision: saved.revision,
          form_version_id: saved.form.id,
          action: profile.submitted_at
            ? 'revise'
            : step === 0
              ? 'draft'
              : 'submit',
          step: 1,
          values,
        }),
      )
      setSaved(next)
      if (step === 0) setStep(1)
      else onSaved(next)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <OnboardingFrame
      step={step}
      userId={userId}
      scope={
        step === 0
          ? profile.submitted_at
            ? 'participant-edit-context'
            : 'participant-setup-context'
          : 'participant-setup-rhythm'
      }
      title={step === 0 ? '学习情境与计划背景' : '描述你的工作节奏'}
      description={
        step === 0
          ? '这些信息帮助 HumanOS 理解你的学习情境。'
          : '这些是长期倾向，不会被某一天的状态直接覆盖。'
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {profile.submitted_at && (
          <p className="mt-4 text-sm text-muted-foreground">
            两页资料可来回修改；在工作节奏页点击保存后生效。
          </p>
        )}
        <ProfileFields
          questions={questions}
          allQuestions={profile.form.content.questions}
          values={values}
          onChange={setValues}
          busy={busy}
        />
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}。填写内容已保留，请修正或重试。
          </p>
        )}
        {onCancel && (
          <OnboardingButton
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onCancel}
          >
            取消本次修改，返回可用时间
          </OnboardingButton>
        )}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <OnboardingButton
            data-tour="setup-back"
            type="button"
            variant="outline"
            disabled={step === 0 || busy}
            onClick={() => {
              setError('')
              setStep(0)
            }}
          >
            上一步
          </OnboardingButton>
          <OnboardingButton
            data-tour="setup-next"
            disabled={busy}
            type="submit"
          >
            {busy
              ? '正在保存…'
              : step === 0
                ? profile.submitted_at
                  ? '下一步'
                  : '保存并下一步'
                : '保存并继续填写可用时间'}
          </OnboardingButton>
        </div>
      </form>
    </OnboardingFrame>
  )
}

export function ProfileEditor({ userId }: { userId: string }) {
  const [form, setForm] = useState<ProfileFormVersion | null>(null),
    [value, setValue] = useState<Configuration | null>(null)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false)
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(
    {},
  )
  const load = useCallback(() => {
    setError('')
    api<ProfileFormVersion>('profile-form')
      .then((v) => {
        setForm(v)
        setValue(v.content)
      })
      .catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])
  async function save() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await api<ProfileFormVersion>(
        'profile-form',
        'POST',
        mutation({ expected_revision: form!.revision, content: value }),
      )
      setForm(next)
      setValue(next.content)
      setNotice(
        '已保存。新开始填写的参与者使用此版本；已有填写及会话保留原版本。',
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SimulationTour scope="profile-editor" userId={userId} ready={!!value} />
      <Link href="/app/simulation/research" className="text-sm text-indigo-700">
        ← 返回研究者控制台
      </Link>
      <Panel title="编辑原 Profile 字段">
        <p className="text-sm text-slate-600">
          默认保留原首次填写的 11
          个字段。直接修改题目、说明、选项与必填设置，无需另外创建 Profile
          问题方案。原字段可停用，历史答案不会被覆盖。
        </p>
      </Panel>
      {error && (
        <p role="alert" className="text-rose-700">
          {error}{' '}
          <button onClick={load} className="underline">
            重新读取配置
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="text-emerald-700">
          {notice}
        </p>
      )}
      {!value ? (
        <p>正在读取原 Profile…</p>
      ) : (
        <>
          <QuestionEditor profileOnly value={value} onChange={setValue} />
          <div className="flex gap-3">
            <Button
              tourId="profile-save"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? '正在保存…' : '保存 Profile 配置'}
            </Button>
            <Button secondary onClick={() => setPreview(!preview)}>
              预览参与者表单
            </Button>
          </div>
          {preview && (
            <Panel title="参与者表单预览">
              <ProfileFields
                questions={value.questions}
                values={previewValues}
                onChange={setPreviewValues}
              />
            </Panel>
          )}
        </>
      )}
    </>
  )
}
