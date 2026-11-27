'use client'

import { useRef } from 'react'
import { CalendarDays } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { taskDateInput } from '@/lib/task-fields'

type DateTimePickerProps = {
  value?: string | null
  onChange: (value: string) => void
  className?: string
  min?: string
  ariaLabel?: string
  id?: string
  disabled?: boolean
  placeholder?: string
  timezone?: string
  pickerLabel?: string
}

export function DateTimePicker({ value, onChange, className, min, ariaLabel, id, disabled, placeholder, timezone, pickerLabel = '📅' }: DateTimePickerProps) {
  const input = useRef<HTMLInputElement>(null)
  function openPicker() {
    const element = input.current
    if (!element) return
    element.focus()
    try { element.showPicker?.() } catch { /* Typing remains available in browsers that restrict native pickers. */ }
  }
  return <div className="flex min-w-0 items-center gap-2">
    <Input ref={input} id={id} type="datetime-local" value={taskDateInput(value, timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)} min={min} disabled={disabled} placeholder={placeholder} className={className} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)} />
    <Button type="button" variant="outline" className="h-11 min-w-11 shrink-0 px-3" disabled={disabled} aria-label={pickerLabel === '📅' ? ariaLabel || 'Choose date and time' : pickerLabel} onClick={openPicker}><CalendarDays className="h-5 w-5" aria-hidden="true" />{pickerLabel !== '📅' && <span className="ml-2">{pickerLabel}</span>}</Button>
  </div>
}
