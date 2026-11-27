'use client'

import { useState, type InputHTMLAttributes } from 'react'
import { Input } from '@/components/ui/input'
import { durationInUnit, durationToMinutes, type DurationUnit } from '@/lib/duration-input'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'> & {
  value: string | number
  onValueChange: (minutes: string) => void
  maxMinutes?: number
  zh?: boolean
}

/** Forms and APIs keep minutes; changing the display unit never changes saved work. */
export function DurationInput({ value, onValueChange, maxMinutes, zh = true, ...props }: Props) {
  const [unit, setUnit] = useState<DurationUnit>('minutes')
  return <div className="flex min-w-0 gap-2">
    <Input {...props} type="number" min={unit === 'hours' ? 1 / 60 : 1}
      max={maxMinutes === undefined ? undefined : maxMinutes / (unit === 'hours' ? 60 : 1)}
      step="any" value={durationInUnit(value, unit)}
      onChange={event => onValueChange(durationToMinutes(event.target.value, unit))} />
    <select disabled={props.disabled} aria-label={zh ? '时长单位' : 'Duration unit'}
      className="h-10 shrink-0 rounded-md border bg-background px-2 text-sm"
      value={unit} onChange={event => setUnit(event.target.value as DurationUnit)}>
      <option value="minutes">{zh ? '分钟' : 'Minutes'}</option>
      <option value="hours">{zh ? '小时' : 'Hours'}</option>
    </select>
  </div>
}
