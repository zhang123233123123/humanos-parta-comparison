export type DurationUnit = 'minutes' | 'hours'

export function durationToMinutes(value: string, unit: DurationUnit): string {
  if (!value.trim()) return ''
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return value
  return String(Number((amount * (unit === 'hours' ? 60 : 1)).toPrecision(12)))
}

export function durationInUnit(minutes: string | number, unit: DurationUnit): string {
  if (minutes === '') return ''
  const amount = Number(minutes)
  return Number.isFinite(amount) ? String(amount / (unit === 'hours' ? 60 : 1)) : String(minutes)
}
