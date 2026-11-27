'use client'
import type { Scenario, SimWindow } from '@/lib/contracts/simulation-contracts'
import { Button, Field, inputClass, Panel, TimeInput } from './common'

export function WindowsEditor({
  value,
  onChange,
  zone,
  start,
  end,
  tourPrefix,
}: {
  value: SimWindow[]
  onChange: (v: SimWindow[]) => void
  zone: string
  start: string
  end: string
  tourPrefix?: string
}) {
  return (
    <div className="space-y-2">
      {value.map((w, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <Field
            label={`开始时间 ${i + 1}`}
            tourId={i === 0 && tourPrefix ? `${tourPrefix}-start` : undefined}
          >
            <TimeInput
              value={w.start_at}
              zone={zone}
              onChange={(s) =>
                onChange(
                  value.map((x, j) => (j === i ? { ...x, start_at: s } : x)),
                )
              }
            />
          </Field>
          <Field
            label={`结束时间 ${i + 1}`}
            tourId={i === 0 && tourPrefix ? `${tourPrefix}-end` : undefined}
          >
            <TimeInput
              value={w.end_at}
              zone={zone}
              onChange={(s) =>
                onChange(
                  value.map((x, j) => (j === i ? { ...x, end_at: s } : x)),
                )
              }
            />
          </Field>
          <button
            className="text-sm text-rose-700"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            移除
          </button>
        </div>
      ))}
      <Button
        secondary
        tourId={tourPrefix ? `${tourPrefix}-add` : undefined}
        onClick={() => onChange([...value, { start_at: '', end_at: '' }])}
      >
        ＋ 时间段
      </Button>
    </div>
  )
}
export function ParticipantInputFields({
  value: s,
  onChange,
  section = 'all',
}: {
  section?: 'all' | 'tasks' | 'availability'
  value: Scenario
  onChange: (v: Scenario) => void
}) {
  const patch = (p: Partial<Scenario>) => onChange({ ...s, ...p })
  return (
    <div className="space-y-5">
      <>
        {section !== 'availability' && (
          <Panel tourId="scene-tasks" title="任务">
            {s.tasks.map((t, i) => {
              const edit = (p: Partial<typeof t>) =>
                patch({
                  tasks: s.tasks.map((x, j) => (j === i ? { ...x, ...p } : x)),
                })
              return (
                <div
                  key={t.id}
                  className="mb-4 space-y-3 rounded-xl bg-slate-50 p-4"
                >
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>任务 {i + 1}</span>
                    <button
                      onClick={() =>
                        patch({ tasks: s.tasks.filter((_, j) => j !== i) })
                      }
                    >
                      移除任务
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field
                      label="任务标题"
                      tourId={i === 0 ? 'setup-task-title' : undefined}
                    >
                      <input
                        className={inputClass}
                        value={t.title}
                        onChange={(e) => edit({ title: e.target.value })}
                      />
                    </Field>
                    <Field
                      label="工作量（分钟）"
                      tourId={i === 0 ? 'setup-task-minutes' : undefined}
                    >
                      <input
                        className={inputClass}
                        type="number"
                        value={t.minutes}
                        onChange={(e) =>
                          edit({ minutes: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field
                      label="截止时间"
                      tourId={i === 0 ? 'setup-task-deadline' : undefined}
                    >
                      <TimeInput
                        value={t.deadline_at}
                        zone={s.timezone}
                        onChange={(v) => edit({ deadline_at: v })}
                      />
                    </Field>
                    <Field label="难度（1–10）">
                      <input
                        className={inputClass}
                        type="number"
                        min="1"
                        max="10"
                        value={t.difficulty}
                        onChange={(e) =>
                          edit({ difficulty: Number(e.target.value) })
                        }
                      />
                    </Field>
                    <Field label="认知需求">
                      <select
                        className={inputClass}
                        value={t.demand}
                        onChange={(e) => edit({ demand: e.target.value })}
                      >
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                      </select>
                    </Field>
                    <Field label="补充说明">
                      <input
                        className={inputClass}
                        value={t.description}
                        onChange={(e) => edit({ description: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              )
            })}
            <Button
              secondary
              tourId="setup-add-task"
              onClick={() =>
                patch({
                  tasks: [
                    ...s.tasks,
                    {
                      id: 'task_' + crypto.randomUUID().slice(0, 8),
                      title: '',
                      minutes: 60,
                      deadline_at: '',
                      difficulty: 5,
                      demand: 'medium',
                      description: '',
                    },
                  ],
                })
              }
            >
              ＋ 添加任务
            </Button>
          </Panel>
        )}
        {section !== 'tasks' && (
          <>
            <Panel tourId="scene-availability" title="可用时间">
              <WindowsEditor
                tourPrefix="setup-availability"
                value={s.availability}
                onChange={(v) => patch({ availability: v })}
                zone={s.timezone}
                start={s.start_at}
                end={s.end_at}
              />
            </Panel>
            <Panel tourId="scene-fixed" title="固定活动／保护休息时段">
              <WindowsEditor
                tourPrefix="setup-fixed"
                value={s.fixed_events}
                onChange={(v) => patch({ fixed_events: v })}
                zone={s.timezone}
                start={s.start_at}
                end={s.end_at}
              />
            </Panel>
          </>
        )}
      </>
    </div>
  )
}
