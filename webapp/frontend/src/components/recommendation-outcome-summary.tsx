import type { RecommendationEffectSummary } from '@/lib/contracts/execution-contracts'
import type { ChoiceStatus } from '@/lib/contracts/recommendation-choice'
import { choiceLabel, choiceStatusLabel } from '@/lib/presentation/recommendation-choice'

const statuses: ChoiceStatus[] = ['original_accepted', 'alternative_selected', 'declined', 'unknown']

export function RecommendationOutcomeSummary({ summary, locale }: { summary: RecommendationEffectSummary; locale: string }) {
  const zh = locale === 'zh'
  if (summary.recommendation_count === 0) {
    return <p className="text-sm text-muted-foreground">{zh ? '目前还没有 DSS 建议反馈。' : 'No DSS recommendation feedback yet.'}</p>
  }
  // Never relabel the old backend's accepted/rejected totals during rollout.
  if (!summary.outcomes_by_choice) {
    return <p role="status" className="text-sm text-muted-foreground">{zh ? '后端尚未提供分类统计，请更新服务后重试。' : 'Categorized statistics are unavailable. Update the backend and retry.'}</p>
  }
  const counts = [summary.accepted_count, summary.alternative_count, summary.rejected_count, summary.unknown_count]
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
      {statuses.map((status, index) => <Metric key={status} value={counts[index]} label={choiceStatusLabel(status, locale)} />)}
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="mb-2 text-left text-muted-foreground">{zh ? '按选择类型分别汇总执行后的观察结果' : 'Observed execution outcomes by choice'}</caption>
        <thead><tr>{(zh ? ['选择类型', '已执行', '已有结果', '完成', '再次中断', '典型恢复分钟'] : ['Choice', 'Applied', 'With outcomes', 'Completed', 'Reinterrupted', 'Median resume (min)']).map(label => <th key={label} className="border-b p-2 font-medium">{label}</th>)}</tr></thead>
        <tbody>{statuses.map(status => {
          const group = summary.outcomes_by_choice[status]
          return <tr key={status}>
            <td className="border-b p-2">{choiceStatusLabel(status, locale)}</td>
            <td className="border-b p-2">{group.applied_count}</td>
            <td className="border-b p-2">{group.settled_outcome_count}</td>
            <td className="border-b p-2">{group.completion.completed}</td>
            <td className="border-b p-2">{group.reinterrupted_count}</td>
            <td className="border-b p-2">{group.median_resume_latency_minutes ?? '—'}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
    <p className="text-xs text-muted-foreground">{zh ? '已执行但结果待观察：' : 'Applied, outcomes pending: '}{summary.outcome_pending_count}</p>
    <p className="text-xs leading-5 text-muted-foreground">{zh ? '缺少完整选择记录的历史反馈归为“无法判断”，不算采纳或拒绝。这里只描述选择后的执行结果，不证明建议有效，也不会自动更新画像。' : 'Historical feedback without a complete choice record is unknown, not acceptance or rejection. Outcomes are descriptive, do not establish effectiveness, and do not automatically update profiles.'}</p>
    {summary.recent.length > 0 && <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">{zh ? '查看最近建议' : 'View recent recommendations'}</summary>
      <div className="mt-3 grid gap-2">{summary.recent.map(item => <div key={item.recommendation_id} className="rounded-lg border bg-background p-3">
        <p className="font-medium">{choiceStatusLabel(item.choice_status, locale)}</p>
        <p className="mt-2">{zh ? '系统原建议：' : 'Original: '}{choiceLabel(item.original_recommendation, locale)}</p>
        <p className="mt-1">{zh ? '最终选择：' : 'Final choice: '}{item.choice_status === 'declined' ? choiceStatusLabel('declined', locale) : choiceLabel(item.selected_choice, locale)}</p>
        <p className="mt-1 text-muted-foreground">{zh ? '恢复等待：' : 'Resume wait: '}{item.resume_latency_minutes ?? '—'} min · {zh ? '结果：' : 'Outcome: '}{item.completion || (item.execution_applied ? (zh ? '待观察' : 'Pending') : (zh ? '无已执行记录' : 'No application recorded'))}</p>
      </div>)}</div>
    </details>}
  </div>
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return <div className="rounded-xl bg-muted p-3"><strong className="block text-xl">{value}</strong><span className="text-[11px] text-muted-foreground">{label}</span></div>
}
