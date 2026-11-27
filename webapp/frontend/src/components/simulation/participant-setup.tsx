'use client'

import { ReactNode, useState } from 'react'
import type {
  PlanningInput,
  ParticipantProfile,
  SimRun,
} from '@/lib/contracts/simulation-contracts'
import { Button } from '@/components/ui/button'
import { OnboardingFrame } from './onboarding-frame'
import { PlanningFields, inputFromRun } from './planning-fields'
import { ProfileReturn } from './profile-return'
import { stamp } from './common'

export function ParticipantSetup({
  run,
  userId,
  busy,
  error,
  form,
  onAction,
  onProfileSaved,
}: {
  run: SimRun
  userId: string
  busy: boolean
  error: string
  form: ReactNode
  onProfileSaved: (p: ParticipantProfile) => void
  onAction: (path: string, body?: Record<string, unknown>) => Promise<void>
}) {
  const [editProfile, setEditProfile] = useState(false)
  const [editingInputs, setEditingInputs] = useState(Boolean(run.setup_draft))
  const [step, setStep] = useState(run.setup_draft ? 3 : 2)
  const [value, setValue] = useState<PlanningInput>(() => inputFromRun(run))
  const [baseRevision, setBaseRevision] = useState(run.revision)
  const [localError, setLocalError] = useState('')
  const stateStep = run.participant_setup_complete !== false && !editingInputs
  const current = stateStep ? 3 : step
  async function save() {
    setLocalError('')
    try {
      if (step === 2) {
        await onAction('setup-draft', {
          expected_revision: baseRevision,
          onboarding_input: value,
        })
        setBaseRevision(baseRevision + 1)
        setStep(3)
      } else {
        await onAction('personal-input', {
          expected_revision: baseRevision,
          onboarding_input: value,
        })
        setBaseRevision(baseRevision + 1)
        setEditingInputs(false)
      }
    } catch (e) {
      setLocalError((e as Error).message)
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
  return (
    <OnboardingFrame
      step={current}
      userId={userId}
      scope={
        stateStep
          ? 'participant-setup-state'
          : current === 2
            ? 'participant-setup-availability'
            : 'participant-setup-tasks'
      }
      title={
        current === 2
          ? run.onboarding_input
            ? '核对已保存的可用时间'
            : '规划你的可用时间'
          : '任务与当前状态'
      }
      description={
        current === 2
          ? run.onboarding_input
            ? '已带入你保存的资料。请核对与本次时间范围是否一致，确认后继续。'
            : '填写能安排任务的时段，以及会议、午休等不能移动的活动。'
          : stateStep
            ? '任务和时间已保存。填写此刻的情况后，系统才会生成计划建议。'
            : '添加你自己想推进的任务，检查时长和截止时间，然后填写当前状态。'
      }
    >
      <p data-tour="setup-dates" className="my-5 text-sm text-muted-foreground">
        本次时间范围：{stamp(run.scenario.start_at, run.scenario.timezone)} –{' '}
        {stamp(run.scenario.end_at, run.scenario.timezone)}
      </p>
      {stateStep ? (
        <div className="space-y-6">
          <details
            className="rounded-xl border bg-background p-4"
            data-tour="setup-saved-tasks"
          >
            <summary className="cursor-pointer text-sm font-medium">
              已保存 {run.scenario.tasks.length} 个任务，查看任务与时间
            </summary>
            <ul className="mt-3 space-y-2 text-sm">
              {run.scenario.tasks.map((t) => (
                <li key={t.id}>
                  {t.title} · {t.minutes} 分钟 · 截止{' '}
                  {stamp(t.deadline_at, run.scenario.timezone)}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted-foreground">
              可用时间：
              {run.scenario.availability
                .map(
                  (w) =>
                    `${stamp(w.start_at, run.scenario.timezone)}–${stamp(w.end_at, run.scenario.timezone)}`,
                )
                .join('；')}
            </p>
          </details>
          <section
            data-tour="setup-initial-state"
            className="rounded-xl border bg-background p-5"
          >
            {form}
          </section>
          <Button
            data-tour="setup-back"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setLocalError('')
              setBaseRevision(run.revision)
              setEditingInputs(true)
              setStep(2)
            }}
          >
            上一步
          </Button>
        </div>
      ) : (
        <>
          <fieldset disabled={busy}>
            <PlanningFields
              step={current}
              value={value}
              onChange={setValue}
              busy={busy}
              showErrors={!!(localError || error)}
              rangeEditable
            />
          </fieldset>
          <div className="mt-8 flex items-center justify-between gap-3 border-t pt-5">
            <Button
              data-tour="setup-back"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setLocalError('')
                if (current === 2) setEditProfile(true)
                else setStep(2)
              }}
            >
              上一步
            </Button>
            <Button
              data-tour="setup-next"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy
                ? '正在保存…'
                : current === 2
                  ? '保存并下一步'
                  : '保存任务并填写当前状态'}
            </Button>
          </div>
        </>
      )}
      {(localError || error) && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {localError || error}。填写内容已保留，请修正或刷新后重试。
        </p>
      )}
    </OnboardingFrame>
  )
}
