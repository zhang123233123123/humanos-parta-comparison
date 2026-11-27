'use client'
import { questionHelp } from './control-help'

import type { Question } from '@/lib/contracts/simulation-contracts'

const preferences = new Set([
  'task_switching_preference',
  'task_distribution_preference',
])
const energy = new Set([
  'typical_energy_morning',
  'typical_energy_afternoon',
  'typical_energy_evening',
])
const presets: Record<string, number[]> = {
  preferred_session_minutes: [25, 45, 60, 90],
  rest_between_tasks_minutes: [5, 10, 15, 20],
}
const control =
  'h-10 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** The original onboarding presentation, with labels/options supplied by the versioned form. */
export function ProfileFields({
  questions,
  allQuestions = questions,
  values,
  onChange,
  busy = false,
}: {
  questions: Question[]
  allQuestions?: Question[]
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  busy?: boolean
}) {
  const visibleValues: Record<string, unknown> = {}
  const visible = new Set(
    allQuestions
      .filter((q) => {
        if (
          !q.enabled ||
          (q.display_if &&
            visibleValues[q.display_if.question_id] !== q.display_if.equals)
        )
          return false
        if (values[q.question_id] !== undefined)
          visibleValues[q.question_id] = values[q.question_id]
        return true
      })
      .map((q) => q.question_id),
  )
  const set = (id: string, value: unknown) =>
    onChange({ ...values, [id]: value })
  return (
    <div className="mx-auto mt-6 grid max-w-3xl grid-cols-6 items-start gap-6">
      {questions
        .filter((q) => visible.has(q.question_id))
        .map((q, index) => {
          const id = `profile-${q.question_id}`
          const isPreference =
            preferences.has(q.question_id) && q.type === 'single'
          const isEnergy = energy.has(q.question_id) && q.type === 'scale'
          const choices =
            q.type === 'number'
              ? presets[q.question_id]?.filter(
                  (v) =>
                    v >= q.minimum &&
                    v <= q.maximum &&
                    Math.abs(
                      (v - q.minimum) / q.step -
                        Math.round((v - q.minimum) / q.step),
                    ) < 1e-8,
                )
              : undefined
          const numeric = values[q.question_id] as number | undefined
          return (
            <fieldset
              key={q.question_id}
              disabled={busy}
              data-tour={`profile-${q.question_id}`}
              data-help-question={q.title}
              data-help-text={questionHelp(q)}
              className={`min-w-0 col-span-6 ${isEnergy ? 'md:col-span-2' : isPreference || choices ? 'sm:col-span-3' : ''}`}
            >
              <legend
                id={`${id}-label`}
                className="mb-2 text-sm font-medium text-foreground"
              >
                {q.title}
                {q.required && <span className="ml-1 text-destructive">*</span>}
                {q.type === 'multiple' && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    可多选
                  </span>
                )}
              </legend>
              {q.help && q.type !== 'text' && (
                <p
                  id={`${id}-help`}
                  className="mb-2 text-xs text-muted-foreground"
                >
                  {q.help}
                </p>
              )}
              {q.type === 'text' && (
                <textarea
                  id={id}
                  aria-labelledby={`${id}-label`}
                  required={q.required}
                  className="block min-h-24 w-full max-w-full resize-y rounded-xl border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={q.help}
                  value={String(values[q.question_id] ?? '')}
                  onChange={(e) => set(q.question_id, e.target.value)}
                />
              )}
              {isPreference && (
                <select
                  id={id}
                  aria-labelledby={`${id}-label`}
                  className={control}
                  required={q.required}
                  value={String(values[q.question_id] ?? '')}
                  onChange={(e) =>
                    set(q.question_id, e.target.value || undefined)
                  }
                >
                  <option value="">请选择</option>
                  {q.options.map((label, i) => (
                    <option
                      key={q.option_values?.[i] || label}
                      value={q.option_values?.[i] || label}
                    >
                      {label}
                    </option>
                  ))}
                </select>
              )}
              {(q.type === 'single' || q.type === 'multiple') &&
                !isPreference && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {q.options.map((label, i) => {
                      const option = q.option_values?.[i] || label
                      const checked =
                        q.type === 'single'
                          ? values[q.question_id] === option
                          : (
                              (values[q.question_id] as string[]) || []
                            ).includes(option)
                      return (
                        <label
                          key={option}
                          className={`flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${checked ? 'border-primary bg-primary/10 text-primary' : 'bg-background'}`}
                        >
                          <input
                            className="mt-0.5 shrink-0 accent-primary"
                            type={q.type === 'single' ? 'radio' : 'checkbox'}
                            name={id}
                            required={
                              q.required &&
                              (q.type === 'single' ||
                                !((values[q.question_id] as string[]) || [])
                                  .length)
                            }
                            checked={checked}
                            onChange={(e) => {
                              const list =
                                (values[q.question_id] as string[]) || []
                              set(
                                q.question_id,
                                q.type === 'single'
                                  ? option
                                  : e.target.checked
                                    ? [...list, option]
                                    : list.filter((v) => v !== option),
                              )
                            }}
                          />
                          <span className="min-w-0 break-words">{label}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              {q.type === 'number' && (
                <div className="space-y-3">
                  {choices && (
                    <div className="flex flex-wrap gap-2">
                      {choices.map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={numeric === v}
                          className={`rounded-lg border px-2.5 py-2 text-sm ${numeric === v ? 'border-primary bg-primary/10 text-primary' : 'bg-background'}`}
                          onClick={() => set(q.question_id, v)}
                        >
                          {v} 分钟
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    id={id}
                    aria-labelledby={`${id}-label`}
                    className={control}
                    type="number"
                    placeholder={
                      choices ? '选择上方时长，或输入分钟数' : '请输入'
                    }
                    min={q.minimum}
                    max={q.maximum}
                    step={q.step}
                    required={q.required}
                    value={numeric ?? ''}
                    onChange={(e) =>
                      set(
                        q.question_id,
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value),
                      )
                    }
                  />
                </div>
              )}
              {isEnergy && (
                <div className="space-y-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <input
                      type="range"
                      aria-labelledby={`${id}-label`}
                      aria-valuetext={
                        numeric === undefined
                          ? '尚未填写，请拖动选择'
                          : String(numeric)
                      }
                      min={q.minimum}
                      max={q.maximum}
                      step={q.step}
                      value={numeric ?? q.minimum}
                      className="min-w-0 flex-1 cursor-pointer touch-pan-y accent-primary"
                      onInput={(e) =>
                        set(q.question_id, Number(e.currentTarget.value))
                      }
                      onPointerUp={(e) =>
                        set(q.question_id, Number(e.currentTarget.value))
                      }
                    />
                    <input
                      id={id}
                      aria-label={`${q.title}数值`}
                      type="number"
                      min={q.minimum}
                      max={q.maximum}
                      step={q.step}
                      required={q.required}
                      placeholder="—"
                      value={numeric ?? ''}
                      className="h-9 w-12 rounded-md border bg-background px-1 text-center text-sm"
                      onChange={(e) =>
                        set(
                          q.question_id,
                          e.target.value === ''
                            ? undefined
                            : Number(e.target.value),
                        )
                      }
                    />
                    <span className="shrink-0 text-sm">/{q.maximum}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{q.low_label || q.minimum}</span>
                    <span>{numeric === undefined ? '未填写' : ''}</span>
                    <span>{q.high_label || q.maximum}</span>
                  </div>
                </div>
              )}
              {q.type === 'scale' && !isEnergy && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {Array.from(
                      {
                        length: Math.min(
                          101,
                          Math.floor((q.maximum - q.minimum) / q.step) + 1,
                        ),
                      },
                      (_, n) => Number((q.minimum + n * q.step).toFixed(6)),
                    ).map((v) => (
                      <label
                        key={v}
                        className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${numeric === v ? 'border-primary bg-primary/10 text-primary' : 'bg-background'}`}
                      >
                        <input
                          type="radio"
                          name={id}
                          required={q.required}
                          checked={numeric === v}
                          className="mr-2 accent-primary"
                          onChange={() => set(q.question_id, v)}
                        />
                        {v}
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {q.minimum} · {q.low_label}
                    </span>
                    <span>
                      {q.maximum} · {q.high_label}
                    </span>
                  </div>
                </div>
              )}
            </fieldset>
          )
        })}
    </div>
  )
}
