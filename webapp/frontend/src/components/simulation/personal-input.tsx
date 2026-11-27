'use client'
import { useState } from 'react'
import type { Scenario, SimRun } from '@/lib/contracts/simulation-contracts'
import { ParticipantInputFields } from './participant-input-fields'
import { Button, stamp } from './common'

export function PersonalInput({
  run,
  busy,
  onSave,
}: {
  run: SimRun
  busy: boolean
  onSave: (
    input: Pick<Scenario, 'tasks' | 'availability' | 'fixed_events'>,
    expectedRevision: number,
  ) => Promise<void>
}) {
  const [value, setValue] = useState<Scenario>({
    ...run.scenario,
    events: [],
    session_minutes: 45,
    rest_minutes: 10,
  })
  const [expectedRevision] = useState(run.revision)
  const [error, setError] = useState('')
  return (
    <div className="space-y-5" data-tour="personal-input">
      <p className="text-sm text-muted-foreground">
        请填写你自己的任务、可用时间和固定活动。时间范围：
        {stamp(run.scenario.start_at, run.scenario.timezone)}–
        {stamp(run.scenario.end_at, run.scenario.timezone)}。
        {run.active_plan &&
          '修改保存后需要重新生成并确认安排，之前的计划保留在历史记录中。'}
      </p>
      <fieldset disabled={busy} className="space-y-5">
        <ParticipantInputFields value={value} onChange={setValue} />
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}，填写内容已保留。
        </p>
      )}
      <Button
        disabled={busy}
        tourId="personal-input-save"
        onClick={async () => {
          setError('')
          try {
            await onSave(
              {
                tasks: value.tasks,
                availability: value.availability,
                fixed_events: value.fixed_events,
              },
              expectedRevision,
            )
          } catch (e) {
            setError((e as Error).message)
          }
        }}
      >
        {busy ? '正在保存…' : '保存我的任务与时间'}
      </Button>
    </div>
  )
}
