'use client'
import { useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DurationInput } from '@/components/ui/duration-input'
import { Input } from '@/components/ui/input'
import { type ActivityDraft, type ActivityType, type PlanningDates, dateLabel, newActivity, validateActivity, weekdays, weekday } from '@/lib/onboarding-activities'

const activityPresets: { title: string; type: ActivityType }[] = [
  { title: '会议', type: 'fixed_event' }, { title: '课程', type: 'fixed_event' },
  { title: '午餐', type: 'recurring_routine' }, { title: '午睡', type: 'recurring_routine' },
  { title: '晚餐', type: 'recurring_routine' }, { title: '运动', type: 'flexible_activity' },
]

const selectedDays = (item: ActivityDraft) => item.frequency === 'once' ? [weekday(item.date)] : item.frequency === 'daily' ? [0,1,2,3,4,5,6] : item.weekdays
const typeLabels = { fixed_event: '固定任务', recurring_routine: '偏好任务', flexible_activity: '灵活任务' }
export function activitySummary(item: ActivityDraft) {
  const days = [...selectedDays(item)].sort()
  const repeat = item.frequency === 'once' ? dateLabel(item.date) : days.length === 7 ? '每天' : days.join(',') === '0,1,2,3,4' ? '每个工作日' : days.length ? `每周${days.map(d => weekdays[d]?.slice(1)).join('、')}` : '尚未选择星期'
  const time = item.type === 'fixed_event' ? `${item.fixed.start}–${item.fixed.end}` : item.type === 'recurring_routine' ? `偏好 ${item.preferred.start}–${item.preferred.end} · ${item.preferred.minutes}分钟/次` : `${item.flexible.minutes}分钟${item.frequency === 'once' ? '' : '/次'} · ${item.flexible.window === 'limited' ? `允许 ${item.flexible.start}–${item.flexible.end}` : '在可用时间内安排'}`
  return `${repeat} · ${time}${item.frequency !== 'once' ? ` · 从${dateLabel(item.startDate)}起` : ''}`
}
export function OnboardingActivities({ items, onChange, period, showErrors, disabled = false }: {
  items: ActivityDraft[]; onChange: (items: ActivityDraft[]) => void; period: PlanningDates | null; showErrors: boolean; disabled?: boolean
}) {
  const [attempted, setAttempted] = useState('')
  const active = items.find(item => item.editing) || (showErrors && period ? items.find(item => !validateActivity(item, period).valid) : undefined)
  const canSwitch = () => {
    if (active && period && !validateActivity(active, period).valid) { setAttempted(active.id); return false }
    return true
  }
  const remove = (id: string) => onChange(items.filter(item => item.id !== id))
  return <section className="space-y-3" aria-labelledby="onboarding-activities-title">
    <h3 id="onboarding-activities-title" className="font-medium">已有活动与日常安排</h3>
    {!period && <p role="status" className="text-sm text-muted-foreground">正在读取账号日期与当前规划期……</p>}
    {period && <p className="text-xs text-muted-foreground">本次安排范围：{dateLabel(period.start)} — {dateLabel(period.end)}</p>}
    {period && items.map((item, index) => active?.id === item.id
      ? <ActivityCard key={item.id} item={item} index={index} period={period} showErrors={showErrors || attempted === item.id} disabled={disabled}
          onChange={next => onChange(items.map(value => value.id === item.id ? next : value))} onRemove={() => remove(item.id)}
          onDone={() => { if (!validateActivity(item, period).valid) { setAttempted(item.id); return }; setAttempted(''); onChange(items.map(value => value.id === item.id ? { ...value, editing: false, added: true } : value)) }} />
      : <article key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-[#fafaf6] px-4 py-3">
          <div className="min-w-0 flex-1"><p className="break-words text-sm"><strong>{item.title || '未命名活动'}</strong><span className="text-muted-foreground"> · {typeLabels[item.type]}</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">{activitySummary(item)}</p>
            {!validateActivity(item, period).valid && <p role="alert" className="mt-1 text-xs text-red-700">尚未填写完整：{Object.values(validateActivity(item, period).errors).join(' ')}</p>}
          </div>
          <div className="flex shrink-0 gap-1"><Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={`编辑活动 ${index + 1}`} onClick={() => { if (canSwitch()) { setAttempted(''); onChange(items.map(value => ({ ...value, added: value.id === active?.id ? true : value.added, editing: value.id === item.id }))) } }}>编辑</Button><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => remove(item.id)} aria-label={`删除活动 ${index + 1}`}>删除</Button></div>
        </article>)}
    <Button type="button" variant="outline" disabled={!period || disabled} onClick={() => { if (period && canSwitch()) { setAttempted(''); onChange([...items.map(item => ({ ...item, added: item.id === active?.id ? true : item.added, editing: false })), newActivity(`ctx_${crypto.randomUUID()}`, period)]) } }}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />添加活动</Button>
  </section>
}

export function ActivityCard({ item, index, period, showErrors, disabled, onChange, onRemove, onDone }: {
  item: ActivityDraft; index: number; period: PlanningDates; showErrors: boolean; disabled?: boolean; onChange: (value: ActivityDraft) => void; onRemove: () => void; onDone?: () => void
}) {
  const [touched, setTouched] = useState<Record<string,boolean>>({})
  const [editStart, setEditStart] = useState(false)
  const validation = validateActivity(item, period)
  const id = (field: string) => `activity-${item.id}-${field}`
  const error = (field: string) => showErrors || touched[field] || validation.errors[field]?.includes('时段只有') || validation.errors[field]?.includes('没有符合条件的日期') ? validation.errors[field] : undefined
  const inputProps = (field: string) => ({ id: id(field), name: field, 'aria-invalid': Boolean(error(field)), 'aria-describedby': error(field) || validation.warnings[field] ? `${id(field)}-feedback` : undefined, onBlur: () => setTouched(current => ({ ...current, [field]: true })) })
  const field = (key: string, label: string, children: ReactNode) => <div className="grid min-w-0 content-start gap-1.5 text-sm">
    <label htmlFor={id(key)} className="font-medium text-[#25302a]">{label}</label>{children}
    {(error(key) || validation.warnings[key]) && <div id={`${id(key)}-feedback`} className="text-xs leading-5">
      {error(key) && <p role="alert" className="text-red-700">{error(key)}</p>}
      {validation.warnings[key] && <p role="status" className="text-amber-800">{validation.warnings[key]}</p>}
    </div>}
  </div>
  const selectClass = 'h-10 w-full min-w-0 rounded-md border bg-white px-2 text-sm'
  const times = (mode: 'fixed' | 'preferred' | 'flexible', startLabel: string, endLabel: string) => <>
    {field(`${mode}.start`, startLabel, <Input {...inputProps(`${mode}.start`)} type="time" value={item[mode].start} onInput={e => onChange({ ...item, [mode]: { ...item[mode], start: e.currentTarget.value } })} />)}
    {field(`${mode}.end`, endLabel, <Input {...inputProps(`${mode}.end`)} type="time" value={item[mode].end} onInput={e => onChange({ ...item, [mode]: { ...item[mode], end: e.currentTarget.value } })} />)}
  </>
  const duration = (mode: 'preferred' | 'flexible') => field(`${mode}.minutes`, item.frequency === 'once' ? '预计用时' : '每次用时', <DurationInput {...inputProps(`${mode}.minutes`)} value={item[mode].minutes} onValueChange={value => onChange({ ...item, [mode]: { ...item[mode], minutes: value } })} />)
  const dateInput = (key: 'date' | 'startDate') => field(key, key === 'date' ? '日期' : '从哪天开始', <div className="flex min-w-0 items-center gap-2"><Input {...inputProps(key)} className="min-w-0 flex-1" type="date" min={period.start} max={period.end} value={item[key]} onInput={e => onChange({ ...item, [key]: e.currentTarget.value })} /><span className="shrink-0 text-xs text-muted-foreground">{dateLabel(item[key]).split(' · ')[1]}</span></div>)
  const defaultStart = period.today > period.start ? period.today : period.start
  return <fieldset disabled={disabled} className="min-w-0 rounded-xl border bg-[#fafaf6] p-4">
    <legend className="sr-only">活动 {index + 1}</legend>
    <div className="mb-3 flex items-center justify-between"><span className="text-xs text-muted-foreground">{item.added === false ? '添加活动' : '编辑活动'}</span><Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onRemove} aria-label={`删除活动 ${index + 1}`}><Trash2 className="h-4 w-4" /></Button></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1.5 text-sm sm:col-span-2">常用活动<select className={selectClass} value="" onChange={e => {
        const preset = activityPresets.find(p => p.title === e.target.value)
        if (preset) onChange({ ...item, title: preset.title, type: preset.type })
      }}><option value="">选择后仍可修改名称和时间</option>{activityPresets.map(p => <option key={p.title} value={p.title}>{p.title}</option>)}</select></label>
      <div className="sm:col-span-2">{field('title', '活动名称', <Input {...inputProps('title')} value={item.title} onChange={e => onChange({ ...item, title: e.target.value })} />)}</div>
      <div>{field('type', '时间类型', <select {...inputProps('type')} className={selectClass} value={item.type} onChange={e => onChange({ ...item, type: e.target.value as ActivityType })}><option value="fixed_event">固定任务</option><option value="recurring_routine">偏好任务</option><option value="flexible_activity">灵活任务</option></select>)}<details className="mt-1 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">区别？</summary><p className="mt-1 leading-5">固定时间会优先保留；有偏好时段的活动尽量安排在你喜欢的时间；时间灵活的活动会结合任务和剩余空闲安排，并遵守你限定的范围。</p></details></div>

      {<fieldset className="min-w-0 sm:col-span-2" aria-describedby={error('weekdays') ? `${id('weekdays')}-feedback` : undefined}>
        <legend className="mb-1.5 text-sm font-medium">每周哪几天？</legend><div className="flex flex-wrap items-center gap-x-3 gap-y-2">{weekdays.map((label, day) => <label key={day} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={selectedDays(item).includes(day)} onChange={e => { setTouched(current => ({ ...current, weekdays: true })); onChange({ ...item, frequency: 'weekly', weekdays: e.target.checked ? [...selectedDays(item), day].sort() : selectedDays(item).filter(value => value !== day) }) }} />{label}</label>)}<Button type="button" variant="ghost" size="sm" className="h-7 px-1 text-xs" onClick={() => onChange({ ...item, frequency: 'weekly', weekdays: [0,1,2,3,4] })}>工作日</Button><Button type="button" variant="ghost" size="sm" className="h-7 px-1 text-xs" onClick={() => onChange({ ...item, frequency: 'weekly', weekdays: [0,1,2,3,4,5,6] })}>每天</Button></div>
        {error('weekdays') && <p id={`${id('weekdays')}-feedback`} role="alert" className="mt-1 text-xs text-red-700">{error('weekdays')}</p>}
      </fieldset>}
      {item.frequency !== 'once' && <div className="sm:col-span-2">
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><span>{item.startDate === defaultStart ? (defaultStart === period.start ? '从本次规划期开始' : '从本期尚未过去的日期开始') : '从指定日期开始'} · {dateLabel(item.startDate)}</span><Button type="button" size="sm" variant="ghost" className="h-7 px-1 text-xs" aria-expanded={editStart || Boolean(error('startDate'))} aria-controls={id('effective-date')} onClick={() => setEditStart(!editStart)}>{editStart ? '收起' : '修改'}</Button></div>
        {(editStart || Boolean(error('startDate'))) && <div id={id('effective-date')} className="mt-2 max-w-sm">{dateInput('startDate')}</div>}
      </div>}
      {item.type === 'fixed_event' && <div className="grid grid-cols-2 gap-3 sm:col-span-2">{times('fixed', '开始时间', '结束时间')}</div>}
      {item.type === 'recurring_routine' && <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm font-medium">希望安排在</legend><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{times('preferred', '偏好时段开始', '偏好时段结束')}{duration('preferred')}</div></fieldset>}
      {item.type === 'flexible_activity' && <div className="grid grid-cols-2 items-start gap-3 sm:col-span-2">{duration('flexible')}<div className="pt-6 text-xs text-muted-foreground">{item.flexible.window === 'availability' ? <div className="flex flex-wrap items-center gap-1"><span>在可用时间内安排</span><Button type="button" size="sm" variant="ghost" className="h-7 px-1 text-xs" onClick={() => onChange({ ...item, flexible: { ...item.flexible, window: 'limited' } })}>限定时段</Button></div> : <Button type="button" size="sm" variant="ghost" className="h-7 px-1 text-xs" onClick={() => onChange({ ...item, flexible: { ...item.flexible, window: 'availability' } })}>取消限定</Button>}</div>{item.flexible.window === 'limited' && times('flexible', '可安排时段开始', '可安排时段结束')}</div>}
    </div>
    {onDone && <div className="mt-4 flex justify-end"><Button type="button" size="sm" onClick={onDone}>{item.added === false ? '添加' : '完成编辑'}</Button></div>}
  </fieldset>
}
