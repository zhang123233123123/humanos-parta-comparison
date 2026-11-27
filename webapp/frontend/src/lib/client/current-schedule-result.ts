import { apiRequest } from '@/lib/client/api'
import type { PlanDecision, PlanResourceEnvelope } from '@/lib/contracts/planning-contracts'

// Job completion is historical evidence, not authority to show a live draft.
export async function currentScheduleResult(
  historicalResult: PlanDecision,
  weekId: string,
  locale: string,
  request: typeof apiRequest = apiRequest,
): Promise<PlanDecision> {
  const invalid = locale === 'zh'
    ? '排程结果缺少有效的计划信息，请刷新后重试。'
    : 'The scheduling result is missing valid plan information. Refresh and retry.'
  const expired = locale === 'zh'
    ? '这次排程的草案已不再待确认，可能已确认、取消或被替换。请刷新查看当前计划。'
    : 'This draft is no longer pending review. It may have been confirmed, cancelled, or replaced. Refresh to view the current plan.'
  if (!historicalResult.plan_id || !weekId) throw new Error(invalid)
  const response = await request<PlanResourceEnvelope<{ plan: PlanDecision | null }>>(
    `/api/plans/proposed?week_id=${encodeURIComponent(weekId)}`,
    { cache: 'no-store' },
  )
  if (!response?.data || !Object.prototype.hasOwnProperty.call(response.data, 'plan')) {
    throw new Error(invalid)
  }
  const current = response.data.plan
  if (!current || current.plan_status !== 'proposed' ||
      current.plan_id !== historicalResult.plan_id || current.week_id !== weekId) {
    throw new Error(expired)
  }
  if (!Array.isArray(current.plan_patch)) throw new Error(invalid)
  return current
}
