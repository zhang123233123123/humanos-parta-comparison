'use client'

import { taskDateInput, taskDateInstant } from '@/lib/task-fields'
import { useMemo } from 'react'
import { useTranslation } from '@/i18n/LanguageProvider'

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const
const DAYS_ZH = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
type WindowValue = { enabled: boolean; start: string; end: string }

function parseValue(value: string): Record<string, WindowValue> {
  const result = Object.fromEntries(
    DAYS.map((day) => [day, { enabled: false, start: '08:00', end: '21:00' }]),
  ) as Record<string, WindowValue>
  const all = value.match(/Monday-Sunday\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/i)
  if (all) {
    for (const day of DAYS)
      result[day] = { enabled: true, start: all[1], end: all[2] }
    return result
  }
  for (const line of value.split(/\n|;/)) {
    const match = line
      .trim()
      .match(
        /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/i,
      )
    const day =
      match &&
      DAYS.find((item) => item.toLowerCase() === match[1].toLowerCase())
    if (match && day)
      result[day] = { enabled: true, start: match[2], end: match[3] }
  }
  return result
}

function serializeValue(windows: Record<string, WindowValue>) {
  return DAYS.filter((day) => windows[day].enabled)
    .map((day) => `${day} ${windows[day].start}-${windows[day].end}`)
    .join('\n')
}

export function WeeklyAvailabilityPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { locale } = useTranslation()
  const windows = useMemo(() => parseValue(value), [value])
  const update = (day: string, patch: Partial<WindowValue>) =>
    onChange(
      serializeValue({ ...windows, [day]: { ...windows[day], ...patch } }),
    )
  return (
    <div className="divide-y rounded-lg border bg-background px-3 sm:px-5">
      {DAYS.map((day, index) => (
        <div
          key={day}
          className="grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)] items-center gap-2 py-3 sm:grid-cols-[120px_minmax(0,1fr)_20px_minmax(0,1fr)] sm:gap-3"
        >
          <label className="col-span-3 flex cursor-pointer items-center sm:col-span-1 gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded"
              checked={windows[day].enabled}
              onChange={(event) =>
                update(day, { enabled: event.target.checked })
              }
            />
            <span>{locale === 'zh' ? DAYS_ZH[index] : day.slice(0, 3)}</span>
          </label>
          <input
            type="time"
            aria-label={`${locale === 'zh' ? DAYS_ZH[index] + '开始时间' : day + ' start time'}`}
            disabled={!windows[day].enabled}
            value={windows[day].start}
            onChange={(event) => update(day, { start: event.target.value })}
            className="h-10 min-w-0 w-full rounded-md border bg-background px-2 text-sm tabular-nums disabled:opacity-40"
          />
          <span
            aria-hidden="true"
            className="text-center text-muted-foreground"
          >
            –
          </span>
          <input
            type="time"
            aria-label={`${locale === 'zh' ? DAYS_ZH[index] + '结束时间' : day + ' end time'}`}
            disabled={!windows[day].enabled}
            value={windows[day].end}
            onChange={(event) => update(day, { end: event.target.value })}
            className="h-10 min-w-0 w-full rounded-md border bg-background px-2 text-sm tabular-nums disabled:opacity-40"
          />
        </div>
      ))}
    </div>
  )
}

/** Original availability controls, expanded to concrete dates and multiple windows. */
export function DatedAvailabilityPicker({
  dates,
  value,
  onChange,
  timezone,
}: {
  dates: string[]
  value: { start_at: string; end_at: string }[]
  onChange: (value: { start_at: string; end_at: string }[]) => void
  timezone: string
}) {
  const local = (s: string) => taskDateInput(s, timezone)
  const make = (date: string, start: string, end: string) => ({
    start_at: taskDateInstant(`${date}T${start}`, timezone) || '',
    end_at: taskDateInstant(`${date}T${end}`, timezone) || '',
  })
  const replace = (
    index: number,
    patch: Partial<{ start_at: string; end_at: string }>,
  ) => onChange(value.map((w, i) => (i === index ? { ...w, ...patch } : w)))
  const outside = value.filter(
    (w) => !dates.includes(local(w.start_at).slice(0, 10)),
  )
  return (
    <div className="divide-y rounded-lg border bg-background px-3 sm:px-5">
      {dates.map((date) => {
        const rows = value
          .map((w, i) => ({ ...w, index: i }))
          .filter((w) => local(w.start_at).slice(0, 10) === date)
        const label = `${date} · ${DAYS_ZH[(new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7]}`
        return (
          <div key={date} className="space-y-2 py-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={rows.length > 0}
                onChange={(e) =>
                  onChange(
                    e.currentTarget.checked
                      ? [...value, make(date, '08:00', '21:00')]
                      : value.filter(
                          (w) => local(w.start_at).slice(0, 10) !== date,
                        ),
                  )
                }
              />
              {label}
            </label>
            {rows.map((w, n) => (
              <div
                key={w.index}
                className="grid grid-cols-[minmax(0,1fr)_12px_minmax(0,1fr)_auto] items-center gap-2 sm:ml-6"
              >
                <input
                  aria-label={`${label} 开始时间 ${n + 1}`}
                  type="time"
                  value={local(w.start_at).slice(11, 16)}
                  onInput={(e) => {
                    if (e.currentTarget.value)
                      replace(w.index, {
                        start_at: make(date, e.currentTarget.value, '21:00')
                          .start_at,
                      })
                  }}
                  className="h-10 min-w-0 w-full rounded-md border bg-background px-2 text-sm"
                />
                <span>–</span>
                <input
                  aria-label={`${label} 结束时间 ${n + 1}`}
                  type="time"
                  value={local(w.end_at).slice(11, 16)}
                  onInput={(e) => {
                    if (e.currentTarget.value)
                      replace(w.index, {
                        end_at: make(date, '08:00', e.currentTarget.value)
                          .end_at,
                      })
                  }}
                  className="h-10 min-w-0 w-full rounded-md border bg-background px-2 text-sm"
                />
                <button
                  type="button"
                  aria-label={`删除 ${label} 时段 ${n + 1}`}
                  className="text-sm text-muted-foreground"
                  onClick={() =>
                    onChange(value.filter((_, i) => i !== w.index))
                  }
                >
                  删除
                </button>
              </div>
            ))}
            {rows.length > 0 && (
              <button
                type="button"
                className="text-xs text-primary sm:ml-6"
                onClick={() =>
                  onChange([...value, make(date, '14:00', '18:00')])
                }
              >
                ＋ 添加当天其他时段
              </button>
            )}
          </div>
        )
      })}
      {outside.length > 0 && (
        <div role="alert" className="py-3 text-sm text-destructive">
          有 {outside.length}{' '}
          个已填时段不在当前日期范围内。请恢复日期范围，或明确删除这些时段。
          <button
            type="button"
            className="ml-2 underline"
            onClick={() =>
              onChange(
                value.filter((w) =>
                  dates.includes(local(w.start_at).slice(0, 10)),
                ),
              )
            }
          >
            删除范围外时段
          </button>
        </div>
      )}
    </div>
  )
}
