import type { ChoiceSnapshot, ChoiceStatus } from '../contracts/recommendation-choice'

export function choiceKey(choice: ChoiceSnapshot): string {
  switch (choice.action) {
    case 'short_break': return JSON.stringify([choice.action, choice.break_minutes ?? null])
    case 'continue_current': return JSON.stringify([choice.action, choice.duration_minutes ?? null])
    case 'switch_task': return JSON.stringify([choice.action, choice.target_execution_session_id ?? null, choice.duration_minutes ?? null])
    default: return choice.action
  }
}

export function choiceLabel(choice: ChoiceSnapshot | null | undefined, locale: string): string {
  const zh = locale === 'zh'
  if (!choice) return zh ? '未记录完整选项' : 'Full choice not recorded'
  const minutes = choice.action === 'short_break' ? choice.break_minutes : choice.duration_minutes
  const duration = minutes == null ? '' : ` · ${minutes} ${zh ? '分钟' : 'min'}`
  switch (choice.action) {
    case 'short_break': return (zh ? '短暂休息' : 'Take a short break') + duration
    case 'continue_current': return (zh ? '继续当前任务' : 'Continue current task') + duration
    case 'switch_task': return (zh ? '切换到：' : 'Switch to: ') + (choice.target_task_title || choice.target_execution_session_id || (zh ? '目标未记录' : 'Target not recorded')) + duration
    case 'continue_later': return zh ? '晚些时候继续' : 'Continue later'
    default: return zh ? '无法识别的选项' : 'Unrecognized choice'
  }
}

export function choiceStatusLabel(status: ChoiceStatus, locale: string): string {
  const labels: Record<ChoiceStatus, [string, string]> = {
    original_accepted: ['采纳原建议', 'Original accepted'],
    alternative_selected: ['选择替代方案', 'Alternative selected'],
    declined: ['不采用', 'Declined'],
    unknown: ['无法判断', 'Unknown'],
  }
  return (labels[status] || labels.unknown)[locale === 'zh' ? 0 : 1]
}
