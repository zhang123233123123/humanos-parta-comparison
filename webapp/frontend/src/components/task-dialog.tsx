'use client'

import { useEffect, useState } from 'react'
import { taskDateInput, taskDateInstant } from '@/lib/task-fields'
import { useInteractionBlock, useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DurationInput } from '@/components/ui/duration-input'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Input } from '@/components/ui/input'
import { useTranslation } from '@/i18n/LanguageProvider'
import { toast } from 'sonner'

interface TaskData {
  id?: string
  title: string
  task_type?: string
  deadline_at?: string | null
  duration?: number
  priority?: string
  expected_difficulty?: number | null
  dependency?: string
  context?: string
}

interface TaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (task: TaskData) => Promise<void>
  onDelete?: () => Promise<void>
  initialData?: TaskData
  timezone?: string
  presentation?: 'dialog' | 'inline'
}

export function TaskDialog({
  timezone: suppliedTimezone,
  open,
  onOpenChange,
  onSave,
  onDelete,
  initialData,
  presentation = 'dialog',
}: TaskDialogProps) {
  const runtime = useWorkspaceRuntime()
  const timezone = suppliedTimezone || runtime?.snapshot?.profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  useInteractionBlock('structured-task-dialog', open)
  const { t, locale } = useTranslation()
  const [loading, setLoading] = useState(false)

  const taskType = initialData?.task_type || (initialData?.id ? undefined : 'flexible_task')
  const [title, setTitle] = useState(initialData?.title || '')
  const [deadline_at, setDue] = useState(taskDateInput(initialData?.deadline_at, timezone))
  const [duration, setDuration] = useState(initialData?.duration?.toString() || '')
  const [priority, setPriority] = useState(({ high: '高', medium: '中', low: '低' } as Record<string, string>)[initialData?.priority || ''] || initialData?.priority || '中')
  const [context, setContext] = useState(initialData?.context || '')
  const [difficulty, setDifficulty] = useState(initialData?.expected_difficulty?.toString() || '')
  const [dependency, setDependency] = useState(initialData?.dependency || '')
  const [fieldError, setFieldError] = useState('')

  const isEdit = !!initialData?.id
  const zh = locale === 'zh'
  const fieldId = `task-form-${initialData?.id || 'new'}`

  useEffect(() => {
    if (!open) return
    setTitle(initialData?.title || '')
    setDue(taskDateInput(initialData?.deadline_at, timezone))
    setDuration(initialData?.duration?.toString() || '')
    setPriority(({ high: '高', medium: '中', low: '低' } as Record<string, string>)[initialData?.priority || ''] || initialData?.priority || '中')
    setContext(initialData?.context || '')
    setDifficulty(initialData?.expected_difficulty?.toString() || '')
    setDependency(initialData?.dependency || '')
    setFieldError('')
  }, [open, timezone, initialData?.task_type, initialData?.id, initialData?.title, initialData?.deadline_at, initialData?.duration, initialData?.priority, initialData?.context, initialData?.expected_difficulty, initialData?.dependency])

  const handleSave = async () => {
    if (!title.trim()) {
      toast(locale === 'zh' ? '请填写任务名称' : 'Please enter a task name')
      return
    }
    if (difficulty !== '' && (!Number.isInteger(Number(difficulty)) || Number(difficulty) < 1 || Number(difficulty) > 10)) {
      setFieldError(zh ? '难度请填写 1–10 的整数，或留空。' : 'Enter a whole number from 1 to 10, or leave difficulty empty.')
      return
    }
    if (taskType !== 'fixed_event' && !deadline_at) { setFieldError(zh ? '请填写任务截止时间。' : 'Enter the task deadline.'); return }
    if (!Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > 1440) { setFieldError(zh ? '请填写 1–1440 的整数分钟。' : 'Enter 1–1440 whole minutes.'); return }
    setFieldError('')
    setLoading(true)
    try {
      await onSave({
        id: initialData?.id,
        title: title.trim(),
        deadline_at: taskDateInstant(deadline_at, timezone),
        duration: Number(duration),
        // Existing type, schedule, analysis and execution state are owned by the backend.
        ...(!isEdit ? { task_type: 'flexible_task' } : {}),
        priority,
        context,
        expected_difficulty: difficulty === '' ? null : Number(difficulty), dependency: dependency.trim(),
      })
      onOpenChange(false)
    } catch (error) {
      toast(error instanceof Error ? error.message : (locale === 'zh' ? '任务保存失败，请重试。' : 'Failed to save task'))
    }
    setLoading(false)
  }

  const handleDelete = async () => {
    if (!onDelete) return
    setLoading(true)
    try {
      await onDelete()
      onOpenChange(false)
    } catch {
      toast(locale === 'zh' ? '任务删除失败，请重试。' : 'Failed to delete task')
    }
    setLoading(false)
  }

  const selectBtn = (value: string, selected: string) =>
    `px-3 py-1.5 text-xs rounded-md border transition-colors ${
      selected === value
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border hover:border-primary/50'
    }`

  const textareaClass =
    'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 min-h-[60px] resize-y'

  const form = <>

        <div className="grid content-start gap-3 py-3 flex-1 overflow-y-auto">
          {/* Task Name */}
          <div>
            <label htmlFor={`${fieldId}-title`} className="text-sm font-medium block mb-1.5">{t('taskDialog.titleLabel')}</label>
            <Input id={`${fieldId}-title`} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className={presentation === 'inline' ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'}>
            <div>
              <label htmlFor={`${fieldId}-deadline_at`} className="text-sm font-medium block mb-1.5">{zh ? (taskType === 'flexible_task' ? '截止日期 / 时间（必填）' : '截止日期 / 时间') : (taskType === 'flexible_task' ? 'Deadline date / time (required)' : 'Deadline date / time')}</label>
              <DateTimePicker
                id={`${fieldId}-deadline_at`}
                className="min-w-0"
                pickerLabel={zh ? '选择日期' : 'Choose date'}
                placeholder={t('taskDialog.duePlaceholder')}
                value={deadline_at}
                onChange={setDue}
              />
            </div>
            <div>
              <label htmlFor={`${fieldId}-duration`} className="text-sm font-medium block mb-1.5">{zh ? '预计用时' : 'Estimated duration'}</label>
              <DurationInput id={`${fieldId}-duration`} value={duration} onValueChange={setDuration} maxMinutes={1440} zh={zh} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <span id={`${fieldId}-priority`} className="text-sm font-medium block mb-1.5">{t('taskDialog.priorityLabel')}</span>
              <div role="group" aria-labelledby={`${fieldId}-priority`} className="flex flex-wrap gap-1">
                {[
                  { v: '高', k: 'priorityHigh' },
                  { v: '中', k: 'priorityMedium' },
                  { v: '低', k: 'priorityLow' },
                ].map(({ v, k }) => (
                  <button
                    key={v}
                    type="button"
                    className={selectBtn(v, priority)}
                    aria-pressed={priority === v}
                    onClick={() => setPriority(v)}
                  >
                    {t(`taskDialog.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor={`${fieldId}-difficulty`} className="text-sm font-medium block mb-1.5">{zh ? '难度（1–10）' : 'Difficulty (1–10)'}</label>
              <Input id={`${fieldId}-difficulty`} type="number" min={1} max={10} step={1} value={difficulty} placeholder={zh ? '未填写' : 'Not specified'} onChange={event => { setDifficulty(event.target.value); setFieldError('') }} />
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-dependency`} className="text-sm font-medium block mb-1.5">{zh ? '需要先完成的任务（可选）' : 'Tasks to finish first (optional)'}</label>
            <Input id={`${fieldId}-dependency`} value={dependency} onChange={event => setDependency(event.target.value)} />
          </div>

          <div>
            <label htmlFor={`${fieldId}-context`} className="text-sm font-medium block mb-1.5">{zh ? '任务说明（可选）' : 'Brief description (optional)'}</label>
            <textarea id={`${fieldId}-context`} className={textareaClass} value={context} onChange={event => setContext(event.target.value)} rows={2} />
          </div>
          {fieldError && <p role="alert" className="text-xs text-destructive">{fieldError}</p>}
        </div>

        <div className="flex justify-between border-t pt-4 shrink-0">
          <div>
            {isEdit && onDelete && (
              <Button variant="destructive" onClick={handleDelete} disabled={loading}>
                {t('taskDialog.deleteTask')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
              {t('taskDialog.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? '...' : t('taskDialog.save')}
            </Button>
          </div>
        </div>
  </>
  if (presentation === 'inline') return open ? <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4" aria-label={isEdit ? t('taskDialog.editTask') : t('taskDialog.addTask')}>{form}</div> : null
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
      <DialogHeader><DialogTitle>{isEdit ? t('taskDialog.editTask') : t('taskDialog.addTask')}</DialogTitle></DialogHeader>
      {form}
    </DialogContent>
  </Dialog>
}
