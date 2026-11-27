import type { DailyPlanReview, RuntimeState } from '../contracts/checkin-contracts'
/** A saved report and a failed review are distinct outcomes. Review retries must
 * call only the review endpoint, never this persistence operation again. */
export async function saveThenReview(
  save: () => Promise<{ runtime_state: RuntimeState; daily_plan_review: DailyPlanReview | null }>,
  review: () => Promise<DailyPlanReview>,
): Promise<{runtime_state:RuntimeState;daily_plan_review:DailyPlanReview|null}> {
  const result = await save()
  if (result.daily_plan_review) return result
  try { return { ...result, daily_plan_review: await review() } }
  catch { return { ...result, daily_plan_review: null } }
}
