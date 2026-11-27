'use client'

import { useTranslation } from '@/i18n/LanguageProvider'
import { DateTimePicker } from '@/components/ui/date-time-picker'

export function TaskTypeFields({ taskType, startAt, onTypeChange, onStartChange }: {
  taskType: string; startAt: string; onTypeChange: (value: string) => void; onStartChange: (value: string) => void
}) {
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-sm"><span className="mb-1 block">{zh ? '任务类型（必选）' : 'Task type (required)'}</span>
      <select className="h-10 w-full rounded-md border bg-background px-3" required value={taskType} onChange={e => onTypeChange(e.target.value)}>
        <option value="">{zh ? '请选择任务类型' : 'Select task type'}</option>
        <option value="fixed_event">{zh ? '固定任务' : 'Fixed task'}</option>
        <option value="flexible_task">{zh ? '普通任务' : 'Ordinary task'}</option>
      </select>
    </label>
    {taskType === 'fixed_event' && <label className="text-sm"><span className="mb-1 block">{zh ? '开始时间（必填）' : 'Start time (required)'}</span>
      <DateTimePicker value={startAt} onChange={onStartChange} />
    </label>}
  </div>
}
