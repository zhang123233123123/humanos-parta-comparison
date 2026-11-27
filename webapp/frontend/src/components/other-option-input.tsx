'use client'
import { Input } from '@/components/ui/input'

export function otherOptionValue(selection: string, custom: string) {
  return selection === 'other' && custom.trim() ? `other: ${custom.trim()}` : selection
}
export function OtherOptionInput({ selected, value, onChange, zh }: { selected: string; value: string; onChange: (value: string) => void; zh: boolean }) {
  if (selected !== 'other') return null
  return <label className="grid gap-1 text-sm">{zh ? '其他说明' : 'Other details'}<Input maxLength={240} value={value} onChange={e => onChange(e.target.value)} placeholder={zh ? '请简单说明…' : 'Briefly describe…'} /></label>
}
