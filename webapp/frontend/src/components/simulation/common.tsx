'use client'
import { ReactNode } from 'react'
import { taskDateInput, taskDateInstant } from '@/lib/task-fields'
import type { Question } from '@/lib/contracts/simulation-contracts'

export async function api<T>(
  path: string,
  method = 'GET',
  payload?: unknown,
): Promise<T> {
  const response = await fetch('/api/simulation/' + path, {
    method,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(body.message || `请求失败 (${response.status})`)
  return body.data
}
export const mutation = (body: Record<string, unknown>) => ({
  ...body,
  request_id: crypto.randomUUID(),
})
export function Panel({
  children,
  title,
  tourId,
}: {
  children: ReactNode
  title?: string
  tourId?: string
}) {
  return (
    <section
      data-tour={title ? undefined : tourId}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      {title && (
        <h2 data-tour={tourId} className="mb-4 text-lg font-semibold">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}
export function Button({
  children,
  onClick,
  disabled,
  secondary = false,
  type = 'button',
  tourId,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  secondary?: boolean
  type?: 'button' | 'submit'
  tourId?: string
}) {
  return (
    <button
      type={type}
      data-tour={tourId}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40 ${secondary ? 'border border-slate-300 bg-white text-slate-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
    >
      {children}
    </button>
  )
}
export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900'
export function Field({
  label,
  children,
  tourId,
}: {
  label: string
  tourId?: string
  children: ReactNode
}) {
  return (
    <label
      data-tour={tourId}
      className="block space-y-1 text-sm text-slate-700"
    >
      <span>{label}</span>
      {children}
    </label>
  )
}
export function TimeInput({
  value,
  zone,
  onChange,
  label,
}: {
  label?: string
  value: string
  zone: string
  onChange: (s: string) => void
}) {
  return (
    <input
      className={inputClass}
      type="datetime-local"
      aria-label={label}
      value={value ? taskDateInput(value, zone) : ''}
      onInput={(e) => {
        const value = e.currentTarget.value
        if (value) {
          const parsed = taskDateInstant(value, zone)
          if (parsed) onChange(parsed)
        } else onChange('')
      }}
    />
  )
}
export function stamp(value: string, zone: string) {
  return new Date(value).toLocaleString('zh-CN', {
    timeZone: zone,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
export function freshQuestion(): Question {
  return {
    question_id: 'q_' + crypto.randomUUID().slice(0, 8),
    revision: 1,
    phase: 'node',
    title: '',
    help: '',
    type: 'scale',
    options: [],
    minimum: 1,
    maximum: 7,
    step: 1,
    low_label: '很低',
    high_label: '很高',
    required: true,
    enabled: true,
    model_usage: 'both',
    semantic_binding: '',
    display_if: null,
  }
}
export function starterQuestions(): Question[] {
  return [
    {
      ...freshQuestion(),
      question_id: 'mood',
      phase: 'initial_state',
      title: '现在心情怎么样？',
      type: 'single',
      semantic_binding: 'mood',
      options: ['心情不错', '平静', '低落', '焦虑'],
      option_values: ['positive', 'neutral', 'low', 'anxious'],
    },
    ...(['energy', 'focus', 'stress'] as const).map((key, i) => ({
      ...freshQuestion(),
      question_id: key,
      phase: 'initial_state' as const,
      semantic_binding: key,
      title: ['现在精力如何？', '现在专注程度如何？', '现在压力如何？'][i],
    })),
    {
      ...freshQuestion(),
      question_id: 'current_change',
      title: '当前任务进展和状态有什么变化？你希望如何继续？',
      type: 'text',
    },
    {
      ...freshQuestion(),
      question_id: 'fit',
      phase: 'feedback',
      title: '这份安排符合你此刻的需要吗？',
      model_usage: 'evaluation_only',
      low_label: '完全不符合',
      high_label: '完全符合',
    },
    ...[
      '今天的计划让我满意。',
      '我对今天执行计划的情况感到满意。',
      '使用系统帮助我更高效地工作。',
      '今天的计划符合我的精力、专注和压力状态。',
    ].map((title, i) => ({
      ...freshQuestion(),
      question_id: 'daily_d' + (i + 1),
      phase: 'daily_feedback' as const,
      title,
      model_usage: 'evaluation_only' as const,
      low_label: '非常不同意',
      high_label: '非常同意',
    })),
    {
      ...freshQuestion(),
      question_id: 'daily_d5',
      phase: 'daily_feedback',
      title: '今天计划的工作，你大约完成了多少？',
      type: 'single',
      options: ['0–20%', '21–40%', '41–60%', '61–80%', '81–100%'],
      model_usage: 'evaluation_only',
    },
    {
      ...freshQuestion(),
      question_id: 'burden',
      phase: 'final',
      title: '过程中系统的询问给你带来了多少打扰？',
      model_usage: 'evaluation_only',
      low_label: '完全没有',
      high_label: '非常多',
    },
  ]
}
