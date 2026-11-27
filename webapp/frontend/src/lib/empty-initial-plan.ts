/** Empty setup is not a plan confirmation; never discard work or an active plan. */
export function isEmptyInitialPlan(plan: any, activePlan: unknown, tasks: unknown): boolean {
  return !activePlan && Boolean(plan?.plan_id) && plan.plan_status === 'proposed'
    && plan.validation?.valid === true
    && Array.isArray(plan.plan_patch) && plan.plan_patch.length === 0
    && Array.isArray(plan.unscheduled_tasks) && plan.unscheduled_tasks.length === 0
    && (!plan.unscheduled_activities || (Array.isArray(plan.unscheduled_activities) && plan.unscheduled_activities.length === 0))
    && Array.isArray(tasks) && tasks.length === 0
}
