'use client'

type PreferenceKey = 'task_switching_preference' | 'task_distribution_preference'
type Props = {
  locale: string
  values: Partial<Record<PreferenceKey, string | null>>
  onChange: (key: PreferenceKey, value: string | null) => void
  columns?: boolean
}

export function TaskArrangementPreferences({ locale, values, onChange, columns = false }: Props) {
  const zh = locale === 'zh'
  const fields: Array<{ key: PreferenceKey; label: string; options: Array<[string, string]> }> = [
    { key: 'task_switching_preference', label: zh ? '任务之间怎么安排（可选）' : 'Order across tasks (optional)', options: [
      ['finish_then_switch', zh ? '尽量完成一个任务再换' : 'Prefer finishing one task before switching'],
      ['interleave', zh ? '喜欢不同任务交替' : 'Prefer alternating tasks'],
    ] },
    { key: 'task_distribution_preference', label: zh ? '同一任务跨天怎么安排（可选）' : 'Spread a task across days (optional)', options: [
      ['concentrated', zh ? '尽量集中在一天' : 'Prefer concentrating work in one day'],
      ['spread', zh ? '倾向分散到多天' : 'Prefer spreading work across days'],
    ] },
  ]
  return <div className="space-y-4">
    <div className={columns ? 'grid items-start gap-4 sm:grid-cols-2' : 'space-y-4'}>
    {fields.map(field => <label key={field.key} className="block space-y-2 text-sm">
      <span className="font-medium">{field.label}</span>
      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={values[field.key] ?? ''} onChange={event => onChange(field.key, event.target.value || null)}>
        <option value="">{zh ? '无明确偏好' : 'No stated preference'}</option>
        {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>)}
    </div>
    <p className="text-xs text-muted-foreground">{zh ? '在满足截止时间、依赖、固定安排和休息等约束后参考这些偏好。集中完成也会保留段间休息；你可以随时改回无明确偏好。' : 'These preferences apply after deadlines, dependencies, fixed commitments and rest constraints are met. Concentrated work still includes breaks. You can clear either preference at any time.'}</p>
  </div>
}
