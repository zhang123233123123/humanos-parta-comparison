'use client'

import { getScheduleExplanation, type ScheduleExplanationInput } from '@/lib/schedule-explanation'

export function ScheduleExplanation({ showTitle = true, compact = false, ...input }: ScheduleExplanationInput & {
  compact?: boolean
  showTitle?: boolean
}) {
  const warnings = input.decision?.validation?.warnings || []
  const paragraph = <p className="text-sm leading-6 text-muted-foreground">{getScheduleExplanation(input)}</p>
  const content = warnings.length > 0 ? <div className="space-y-2">{paragraph}
    <ul className="space-y-1 text-sm text-muted-foreground">{warnings.map((warning, index) => {
      const zh = input.locale === 'zh'
      const title = typeof warning.title === 'string' ? warning.title : ''
      const subject = title ? `“${title}”` : (zh ? '偏好活动' : 'A preferred activity')
      const message = warning.type === 'preferred_window_unmet'
        ? (zh ? `${subject}未安排在偏好时段内。` : `${subject} is scheduled outside its preferred time window.`)
        : warning.type === 'preferred_activity_unscheduled'
          ? (zh ? `${subject}尚未安排；普通任务优先。` : `${subject} remains unscheduled; ordinary work takes priority.`)
          : zh ? '部分偏好安排未满足，请查看计划。' : 'Some scheduling preferences could not be met. Review the plan.'
      return <li key={index}>{message}</li>
    })}</ul>
  </div> : paragraph
  if (!showTitle) return content
  return (
    <section className={compact ? 'space-y-2' : 'space-y-2 py-1'} aria-label={input.locale === 'zh' ? '安排说明' : 'Scheduling explanation'}>
      <h3 className="text-sm font-semibold">{input.locale === 'zh' ? '为什么这样安排？' : 'Why this schedule?'}</h3>
      {content}
    </section>
  )
}
