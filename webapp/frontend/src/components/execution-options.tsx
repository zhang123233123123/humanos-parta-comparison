'use client'

import type { HelpDecideRecommendation } from '@/lib/contracts/checkin-contracts'
import { choiceKey, choiceLabel } from '@/lib/presentation/recommendation-choice'

type Option = HelpDecideRecommendation['recommendation']
const copy: Record<string, [string, string]> = {
  continue_preserves_context: ['保留当前上下文；仍需留意状态和后续安排。', 'Keeps current context; consider your state and later commitments.'],
  break_delays_work: ['工作会延后，休息后需重新判断；不保证状态改善。', 'Delays work; reassess afterwards. A break may not improve your state.'],
  defer_requires_plan_review: ['剩余工作保留；选择恢复时间后复核计划草案。', 'Keeps remaining work; choose a return time and review the draft.'],
  switch_requires_reentry: ['推进另一任务；原任务仍需完成，返回时可能需要恢复上下文。', 'Advances another task; the original work remains and may require context recovery.'],
}

export function ExecutionOptions({ options, selected, onSelect, locale, disabled }: {
  options: Option[]; selected: Option; onSelect: (option: Option) => void; locale: string; disabled: boolean
}) {
  const index = locale === 'zh' ? 0 : 1
  return <div className="grid gap-2">
    <p className="text-sm font-medium">{index === 0 ? '比较选项，选择后再确认执行' : 'Compare options, then confirm your choice'}</p>
    {options.map(option => <button type="button" disabled={disabled}
      key={choiceKey(option)}
      aria-pressed={choiceKey(selected) === choiceKey(option)}
      onClick={() => onSelect(option)} className="rounded-xl border bg-background p-3 text-left aria-pressed:border-primary disabled:opacity-50">
      <span className="block font-medium">{choiceLabel(option, locale)}</span>
      <span className="block text-xs text-muted-foreground">{copy[option.consequence_code || '']?.[index]}</span>
      {option.impact?.estimated_end_at && <span className="block text-xs">{index === 0 ? '本段预计结束：' : 'Segment ends: '}{new Date(option.impact.estimated_end_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</span>}
      {option.impact?.break_end_at && <span className="block text-xs">{index === 0 ? '休息结束后重新判断：' : 'Reassess after break: '}{new Date(option.impact.break_end_at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')}</span>}
      {option.impact?.requires_resume_time && <span className="block text-xs">{index === 0 ? '恢复时间尚未确定，需要选择并复核。' : 'Return time is not yet scheduled; choose and review it.'}</span>}
    </button>)}
  </div>
}
