'use client'
import { DatedAvailabilityPicker } from '@/components/weekly-availability-picker'
import { OnboardingActivities } from '@/components/onboarding-activities'
import { newActivity, shiftDate, validDate } from '@/lib/onboarding-activities'
import { taskDateInput, taskDateInstant } from '@/lib/task-fields'
import type {
  PlanningInput,
  Scenario,
  SimRun,
} from '@/lib/contracts/simulation-contracts'
import { ParticipantInputFields } from './participant-input-fields'

export function inputFromRun(run: SimRun): PlanningInput {
  if (run.onboarding_input) return structuredClone(run.onboarding_input)
  const s = run.scenario,
    source = run.setup_draft || s
  const start = taskDateInput(s.start_at, s.timezone).slice(0, 10),
    end = taskDateInput(s.end_at, s.timezone).slice(0, 10)
  return {
    start_date: start,
    end_date: end,
    timezone: s.timezone,
    availability: structuredClone(source.availability),
    activities: source.fixed_events.map((w, i) => {
      const a = taskDateInput(w.start_at, s.timezone),
        b = taskDateInput(w.end_at, s.timezone)
      return {
        ...newActivity(`saved_fixed_${i}`, { start, end, today: start }),
        title: `已保存固定活动 ${i + 1}`,
        frequency: 'once',
        date: a.slice(0, 10),
        editing: false,
        added: true,
        fixed: { start: a.slice(11, 16), end: b.slice(11, 16) },
      }
    }),
    tasks: structuredClone(s.tasks),
    keep_buffer: s.keep_buffer || false,
    planning_goal: s.planning_goal || '',
  }
}
export function PlanningFields({
  value,
  onChange,
  step,
  busy = false,
  showErrors = false,
  rangeEditable = false,
}: {
  value: PlanningInput
  onChange: (v: PlanningInput) => void
  step: number
  busy?: boolean
  showErrors?: boolean
  rangeEditable?: boolean
}) {
  const dates: string[] = []
  if (validDate(value.start_date) && validDate(value.end_date))
    for (
      let d = value.start_date;
      d <= value.end_date && dates.length < 31;
      d = shiftDate(d, 1)
    )
      dates.push(d)
  const period = dates.length
    ? { start: value.start_date, end: value.end_date, today: value.start_date }
    : null
  const scenario: Scenario = {
    name: '我的任务',
    description: '',
    timezone: value.timezone,
    start_at:
      taskDateInstant(value.start_date + 'T00:00', value.timezone) || '',
    end_at: taskDateInstant(value.end_date + 'T23:59', value.timezone) || '',
    tasks: value.tasks,
    availability: value.availability,
    fixed_events: [],
    events: [],
    session_minutes: 45,
    rest_minutes: 10,
  }
  return (
    <fieldset disabled={busy} className="mt-6 min-w-0 space-y-7">
      {step === 2 ? (
        <>
          <div data-tour="setup-dates" className="space-y-2">
            <p className="text-sm font-medium">规划日期 · {value.timezone}</p>
            {rangeEditable ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  开始日期
                  <input
                    aria-label="规划开始日期"
                    type="date"
                    value={value.start_date}
                    onInput={(e) =>
                      onChange({ ...value, start_date: e.currentTarget.value })
                    }
                    className="mt-1 h-10 w-full min-w-0 rounded-md border px-2"
                  />
                </label>
                <label className="text-sm">
                  结束日期
                  <input
                    aria-label="规划结束日期"
                    type="date"
                    value={value.end_date}
                    onInput={(e) =>
                      onChange({ ...value, end_date: e.currentTarget.value })
                    }
                    className="mt-1 h-10 w-full min-w-0 rounded-md border px-2"
                  />
                </label>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {value.start_date} — {value.end_date}
              </p>
            )}
          </div>
          <section data-tour="setup-availability">
            <h3 className="mb-3 text-sm font-medium">
              这些日期中，哪些时间可以安排学习 / 工作任务？
            </h3>
            <DatedAvailabilityPicker
              dates={dates}
              value={value.availability}
              onChange={(availability) => onChange({ ...value, availability })}
              timezone={value.timezone}
            />
          </section>
          <div data-tour="setup-activities">
            <OnboardingActivities
              items={value.activities}
              onChange={(activities) => onChange({ ...value, activities })}
              period={period}
              showErrors={showErrors}
              disabled={busy}
            />
          </div>
          <label
            data-tour="setup-buffer"
            className="flex items-start gap-3 rounded-xl border p-4 text-sm"
          >
            <input
              className="mt-1 h-4 w-4"
              type="checkbox"
              aria-label="保留缓冲时间"
              checked={value.keep_buffer}
              onChange={(e) =>
                onChange({ ...value, keep_buffer: e.currentTarget.checked })
              }
            />
            <span>
              <strong>保留缓冲时间</strong>
              <span className="block text-muted-foreground">
                不要把所有可用窗口排满；扣除固定活动后，每段空闲时间末尾保留
                10%。
              </span>
            </span>
          </label>
        </>
      ) : (
        <>
          <label className="block text-sm font-medium">
            接下来想完成什么？
            <textarea
              className="mt-2 min-h-20 w-full resize-y rounded-xl border bg-background p-3 text-sm"
              value={value.planning_goal}
              onInput={(e) =>
                onChange({ ...value, planning_goal: e.currentTarget.value })
              }
            />
          </label>
          <ParticipantInputFields
            section="tasks"
            value={scenario}
            onChange={(s) => onChange({ ...value, tasks: s.tasks })}
          />
        </>
      )}
    </fieldset>
  )
}
