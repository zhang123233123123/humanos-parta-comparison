'use client'
import { questionHelp } from './control-help'
import { useEffect, useRef, useState } from 'react'
import type { SimBatch } from '@/lib/contracts/simulation-contracts'
import { Button, inputClass } from './common'

export function QuestionForm({
  batch,
  busy,
  onSubmit,
  onPresented,
  preview = false,
  initialValues = {},
  onValuesChange,
  submitLabel = '提交回答',
  contextQuestions,
}: {
  batch: SimBatch
  busy: boolean
  onSubmit: (
    answers: { question_id: string; value: unknown }[],
  ) => Promise<void>
  onPresented?: () => Promise<void>
  preview?: boolean
  initialValues?: Record<string, unknown>
  onValuesChange?: (values: Record<string, unknown>) => void
  submitLabel?: string
  contextQuestions?: SimBatch['questions']
}) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  useEffect(() => {
    onValuesChange?.(values)
  }, [values, onValuesChange])
  const [error, setError] = useState('')
  const presented = useRef(false)
  useEffect(() => {
    const mark = () => {
      if (!document.hidden && !preview && !presented.current && onPresented) {
        presented.current = true
        void onPresented().catch(() => {
          presented.current = false
        })
      }
    }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [onPresented, preview])
  const visibleValues: Record<string, unknown> = {}
  const visibleIds = new Set(
    (contextQuestions || batch.questions)
      .filter((q) => {
        if (!q.enabled) return false
        if (
          q.display_if &&
          visibleValues[q.display_if.question_id] !== q.display_if.equals
        )
          return false
        if (values[q.question_id] !== undefined)
          visibleValues[q.question_id] = values[q.question_id]
        return true
      })
      .map((q) => q.question_id),
  )
  const questions = batch.questions.filter((q) => visibleIds.has(q.question_id))
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault()
        setError('')
        try {
          await onSubmit(
            questions
              .filter(
                (q) =>
                  values[q.question_id] !== undefined &&
                  values[q.question_id] !== '',
              )
              .map((q) => ({
                question_id: q.question_id,
                value: values[q.question_id],
              })),
          )
        } catch (e) {
          setError(e instanceof Error ? e.message : '保存失败')
        }
      }}
    >
      {questions.map((q, index) => (
        <fieldset
          data-tour={index === 0 ? 'answer-first' : undefined}
          data-help-question={q.title}
          data-help-text={questionHelp(q)}
          key={q.question_id}
          className="space-y-2"
          disabled={busy}
        >
          <legend className="font-medium">
            {q.title}
            {q.required && <span className="ml-1 text-rose-600">*</span>}
          </legend>
          {q.help && <p className="text-sm text-slate-500">{q.help}</p>}
          {q.type === 'text' && (
            <textarea
              className={inputClass}
              rows={3}
              required={q.required}
              value={String(values[q.question_id] ?? '')}
              onChange={(e) =>
                setValues({ ...values, [q.question_id]: e.target.value })
              }
            />
          )}
          {q.type === 'number' && (
            <input
              className={inputClass}
              type="number"
              min={q.minimum}
              max={q.maximum}
              step={q.step}
              required={q.required}
              value={(values[q.question_id] as number) ?? ''}
              onChange={(e) =>
                setValues({
                  ...values,
                  [q.question_id]:
                    e.target.value === '' ? undefined : Number(e.target.value),
                })
              }
            />
          )}
          {q.type === 'scale' && (
            <>
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
                    className={`cursor-pointer rounded-lg border px-4 py-3 ${values[q.question_id] === v ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}
                  >
                    <input
                      type="radio"
                      name={q.question_id}
                      className="mr-2"
                      required={q.required}
                      checked={values[q.question_id] === v}
                      onChange={() =>
                        setValues({ ...values, [q.question_id]: v })
                      }
                    />
                    {v}
                  </label>
                ))}
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>
                  {q.minimum} · {q.low_label}
                </span>
                <span>
                  {q.maximum} · {q.high_label}
                </span>
              </div>
            </>
          )}
          {(q.type === 'single' || q.type === 'multiple') && (
            <div className="grid gap-2">
              {q.options.map((label, index) => {
                const option = q.option_values?.[index] || label
                return (
                  <label
                    key={option}
                    className="rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <input
                      className="mr-2"
                      type={q.type === 'single' ? 'radio' : 'checkbox'}
                      name={q.question_id}
                      required={q.type === 'single' && q.required}
                      checked={
                        q.type === 'single'
                          ? values[q.question_id] === option
                          : (
                              (values[q.question_id] as string[]) || []
                            ).includes(option)
                      }
                      onChange={(e) => {
                        const list = (values[q.question_id] as string[]) || []
                        setValues({
                          ...values,
                          [q.question_id]:
                            q.type === 'single'
                              ? option
                              : e.target.checked
                                ? [...list, option]
                                : list.filter((x) => x !== option),
                        })
                      }}
                    />
                    {label}
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>
      ))}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
      {!preview && (
        <Button tourId="answer-submit" disabled={busy} type="submit">
          {busy ? '正在保存…' : submitLabel}
        </Button>
      )}
    </form>
  )
}
