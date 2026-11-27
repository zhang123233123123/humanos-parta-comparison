import { schedulingReason, unscheduledTitle } from '@/lib/presentation/planning-display'
import { DecisionReasonMessage } from '@/components/decision-reason-message'

export function UnscheduledTaskList({ tasks, titles, locale }: {
  tasks: Array<{ task_id?: string; title?: string; remaining_minutes?: number; reason?: string }>
  titles: Map<string, string>
  locale: string
}) {
  return <ul className="mt-3 space-y-3">{tasks.map((task, index) => <li key={`${task.task_id || 'unknown'}-${index}`} className="border-t border-amber-500/20 pt-2">
    <p className="font-medium">{unscheduledTitle(task, titles, locale)}</p>
    {typeof task.remaining_minutes === 'number' && <p className="mt-1">{locale === 'zh' ? `还有 ${task.remaining_minutes} 分钟未安排` : `${task.remaining_minutes} minutes unscheduled`}</p>}
    {task.reason && !/^[a-z][a-z0-9_]*$/i.test(task.reason) ? <p className="mt-1 break-words">{schedulingReason(task.reason, locale)}</p> : <DecisionReasonMessage code={task.reason} locale={locale} />}
  </li>)}</ul>
}
