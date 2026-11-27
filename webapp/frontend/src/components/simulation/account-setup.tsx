'use client'
import { useEffect, useState } from 'react'
import type {
  PlanningSetup,
  ParticipantProfile,
} from '@/lib/contracts/simulation-contracts'
import { Button } from '@/components/ui/button'
import { OnboardingFrame } from './onboarding-frame'
import { PlanningFields } from './planning-fields'
import { ProfileReturn } from './profile-return'
import { ProfileFields } from './profile-fields'
import { api, mutation } from './common'
import { SimulationSignOut } from './sign-out'
import { WorkspaceStart } from './workspace-start'

export function AccountSetup({
  userId,
  onCompleted,
  onWorkspaceReady,
  onEditing,
  onProfileSaved,
}: {
  userId: string
  onCompleted: () => void
  onWorkspaceReady: (id: string) => void
  onEditing: () => void
  onProfileSaved: (profile: ParticipantProfile) => void
}) {
  const [editProfile, setEditProfile] = useState(false)
  const [saved, setSaved] = useState<PlanningSetup | null>(null)
  const [step, setStep] = useState(2),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [edit, setEdit] = useState(false)
  const [reloadingState, setReloadingState] = useState(false)
  const [stateNotice, setStateNotice] = useState('')
  const hasStateQuestions = !!saved?.state_form.questions.some((q) => q.enabled)
  async function reloadStateForm() {
    setReloadingState(true)
    setError('')
    setStateNotice('')
    try {
      const latest = await api<PlanningSetup>('planning-setup')
      if (!latest.state_form.questions.some((q) => q.enabled))
        throw new Error('状态题目仍不可用，请联系研究者检查配置')
      setSaved((current) =>
        current
          ? {
              ...current,
              state_form: latest.state_form,
              state_values:
                current.state_form.id === latest.state_form.id
                  ? current.state_values
                  : latest.state_values,
            }
          : latest,
      )
      setStateNotice('状态题目已重新读取，当前任务和时间输入已保留。')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReloadingState(false)
    }
  }
  const load = () => {
    setError('')
    api<PlanningSetup>('planning-setup')
      .then((v) => {
        setSaved(v)
        setStep(v.step)
        if (v.submitted_at) onCompleted()
      })
      .catch((e) => setError(e.message))
  }
  useEffect(load, [])
  async function save(complete: boolean) {
    if (!saved) return
    if (complete && !hasStateQuestions) {
      setError('状态题目尚未加载，请重新读取状态题目后填写')
      return
    }
    setBusy(true)
    setError('')
    try {
      const v = await api<PlanningSetup>(
        'planning-setup',
        'POST',
        mutation({
          expected_revision: saved.revision,
          action: complete ? 'submit' : 'draft',
          state_form_id: saved.state_form.id,
          input: saved.input,
          state_values: saved.state_values,
        }),
      )
      setSaved(v)
      setStep(3)
      if (complete) {
        setEdit(false)
        onCompleted()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (editProfile)
    return (
      <ProfileReturn
        userId={userId}
        onSaved={(p) => {
          onProfileSaved(p)
          setEditProfile(false)
        }}
        onCancel={() => setEditProfile(false)}
      />
    )
  if (!saved)
    return (
      <div className="p-8">
        <p role={error ? 'alert' : 'status'}>{error || '正在读取首次设置…'}</p>
        {error && <Button onClick={load}>重新读取</Button>}
        <SimulationSignOut />
      </div>
    )
  if (saved.submitted_at && !edit)
    return (
      <WorkspaceStart
        onReady={onWorkspaceReady}
        onEdit={() => {
          setStep(2)
          setEdit(true)
          onEditing()
        }}
      />
    )
  return (
    <OnboardingFrame
      step={step}
      userId={userId}
      scope={
        step === 2
          ? 'participant-setup-availability'
          : 'participant-account-tasks'
      }
      title={step === 2 ? '规划接下来的时间' : '任务与当前状态'}
      description={
        step === 2
          ? '填写你可以学习或工作的时间，以及已有活动和日常安排。'
          : '添加自己的任务，再报告此刻的心情、精力、专注和压力。'
      }
    >
      <PlanningFields
        value={saved.input}
        onChange={(input) => setSaved({ ...saved, input })}
        step={step}
        busy={busy}
        showErrors={!!error}
        rangeEditable
      />
      {step === 3 && (
        <section data-tour="setup-initial-state" className="mt-8 border-t pt-4">
          <h3 className="font-semibold">此刻的状态</h3>
          {!hasStateQuestions && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
            >
              状态题目暂不可用，当前无法填写或完成首次设置。请重新读取状态题目；任务和时间输入会保留。
            </div>
          )}
          {(!hasStateQuestions || error.includes('状态')) && (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              disabled={busy || reloadingState}
              onClick={() => void reloadStateForm()}
            >
              {reloadingState ? '正在读取状态题目…' : '重新读取状态题目'}
            </Button>
          )}
          {stateNotice && (
            <p role="status" className="mt-3 text-sm text-emerald-700">
              {stateNotice}
            </p>
          )}
          <ProfileFields
            questions={saved.state_form.questions}
            values={saved.state_values}
            busy={busy}
            onChange={(state_values) => setSaved({ ...saved, state_values })}
          />
        </section>
      )}
      <div className="mt-8 flex justify-between border-t pt-5">
        <Button
          data-tour="setup-back"
          variant="outline"
          disabled={busy}
          onClick={() => (step === 2 ? setEditProfile(true) : setStep(2))}
        >
          上一步
        </Button>
        {step === 3 && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void save(false)}
          >
            保存草稿
          </Button>
        )}
        <Button
          data-tour="setup-next"
          disabled={
            busy || reloadingState || (step === 3 && !hasStateQuestions)
          }
          onClick={() => void save(step === 3)}
        >
          {busy ? '正在保存…' : step === 2 ? '保存并下一步' : '保存首次设置'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}。当前输入已保留，请修正后重试。
        </p>
      )}
    </OnboardingFrame>
  )
}
