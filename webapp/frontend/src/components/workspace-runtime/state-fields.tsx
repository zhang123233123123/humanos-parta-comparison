'use client'
import { MOODS } from '@/lib/interaction/core'
import type { StateValues } from '@/lib/interaction/contracts'
import { useTranslation } from '@/i18n/LanguageProvider'

export function StateFields({ value, onChange, disabled = false }: { value: StateValues; onChange: (value: StateValues) => void; disabled?: boolean }) {
  const { locale } = useTranslation(); const zh = locale === 'zh'
  return <fieldset disabled={disabled} className="grid min-w-0 gap-4" data-testid="state-fields">
    <legend className="sr-only">{zh ? '当前状态' : 'Current state'}</legend>
    <div><p className="mb-2 text-sm font-medium">{zh ? '现在心情怎么样？' : 'How is your mood?'}</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label={zh ? '心情' : 'Mood'}>{MOODS.map(m => <button key={m.value} type="button" aria-pressed={value.mood === m.value} onClick={() => onChange({ ...value, mood: m.value })} className={`rounded-xl border px-1 py-2 text-xs sm:px-2 sm:text-sm transition ${value.mood === m.value ? 'border-primary bg-primary/10 text-primary' : 'bg-background hover:bg-muted'}`}><span className="mb-1 block text-2xl" aria-hidden="true">{m.emoji}</span>{zh ? m.zh : m.en}</button>)}</div>
    </div>
    {(['energy', 'focus', 'stress'] as const).map(key => <div key={key}><div className="mb-2 flex justify-between gap-2 text-sm"><span id={`state-${key}-label`} className="font-medium">{zh ? { energy: '精力', focus: '专注', stress: '压力' }[key] : { energy: 'Energy', focus: 'Focus', stress: 'Stress' }[key]}</span><span className="text-muted-foreground">{value[key] === null ? (zh ? '请选择' : 'Choose a rating') : `${value[key]}/7`}</span></div><div role="group" aria-labelledby={`state-${key}-label`} className="grid grid-cols-7 gap-1">{[1,2,3,4,5,6,7].map(n => <button type="button" key={n} aria-label={`${key} ${n}`} aria-pressed={value[key] === n} onClick={() => onChange({ ...value, [key]: n })} className={`h-9 rounded-lg border text-sm ${value[key] === n ? 'border-primary bg-primary/10 text-primary' : 'bg-background hover:bg-muted'}`}>{n}</button>)}</div><div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{zh ? '低' : 'Low'}</span><span>{zh ? '高' : 'High'}</span></div></div>)}
    <label className="grid gap-2 text-sm">{zh ? '补充说明（可选）' : 'A note (optional)'}<textarea className="min-h-16 w-full rounded-lg border bg-background p-2" value={value.daily_note} onChange={e => onChange({ ...value, daily_note: e.target.value })} maxLength={1500} /></label>
  </fieldset>
}
