import type { HumanOSTask } from './contracts/task-contracts'
import { emptyState, type StateValues } from './interaction/contracts'
import { wallParts } from './calendar-draft-time'
import { taskActivityRecord } from './onboarding-activities'

/** Rebuild edit inputs from the current read contracts, never development fixtures. */
export function restorePlanningInputs(profile: Record<string, any>, tasks: HumanOSTask[], currentState: Partial<StateValues> | null, previous: Record<string, any> | null) {
  const preferences = profile.task_preferences || {}
  const weekly = profile.weekly_context || {}
  const context = profile.research_context || {}
  const activeTasks = tasks.filter(task => !task.removed_from_week && !['completed', 'terminated'].includes(task.status || '')
    && (!task.week_id || task.week_id === profile.active_week_id))
  const isActivity = (task: HumanOSTask) => {
    const kind = task.task_type
    if (kind && !['fixed_event', 'flexible_task', 'recurring_routine', 'flexible_activity'].includes(kind)) throw new Error('Unsupported task type')
    return kind !== 'flexible_task' && Boolean(kind)
  }
  // Reconcile archives omitted current-week IDs. Preserve fixed events unchanged.
  const preservedTasks = activeTasks.filter(task => isActivity(task) && !task.schedule_constraints)
  const activityTasks = activeTasks.map(taskActivityRecord).filter(Boolean)
  const editableTasks = activeTasks.filter(task => !isActivity(task))
  const state = currentState || (previous?.state_input_version === 2 ? previous.momentary : null)
  return {
    preservedTasks,
    draft: {
      ...previous,
      step: previous?.step ?? 0,
      preview: false,
      publishedPlanId: '',
      timezone: profile.timezone,
      state_input_version: 2,
      difficulty_input_version: 1,
      role: profile.role,
      learningMode: preferences.learning_mode,
      failureReasons: context.planning_failure_reasons || profile.blocker_patterns || [],
      recentFailure: context.recent_plan_failure || '',
      sessionMinutes: preferences.preferred_session_minutes,
      breakMinutes: preferences.rest_between_tasks_minutes,
      arrangement: { task_switching_preference: preferences.task_switching_preference ?? null, task_distribution_preference: preferences.task_distribution_preference ?? null },
      dayEnergy: preferences.typical_energy,
      availableWindows: weekly.weekly_available_windows,
      contextItems: [...(weekly.context_items || []), ...activityTasks],
      keepBuffer: weekly.keep_buffer !== false,
      weeklyGoal: weekly.weekly_goal || '',
      momentary: state ? { mood: state.mood ?? '', energy: state.energy ?? null, focus: state.focus ?? null, stress: state.stress ?? null, daily_note: state.daily_note ?? '' } : emptyState(),
      tasks: editableTasks.map(task => {
        const due = task.deadline_at ?? null
        const loadedDue = inputDateTime(due, profile.timezone)
        const dependency = task.dependency ?? task.contextWindow?.dependency ?? null
        const loadedDependency = dependency == null ? '' : String(dependency)
        return {
          id: task.id,
          persistedId: task.id,
          originalDue: due,
          loadedDue,
          title: task.title || '',
          context: task.context || '',
          task_type: task.task_type || '', start_at: inputDateTime(task.start_at ?? null, profile.timezone),
          deadline_at: loadedDue,
          duration: task.duration == null ? '' : Number(task.duration),
          priority: task.priority || 'medium',
          expected_difficulty: task.expected_difficulty ?? null,
          dependency: loadedDependency,
          loadedDependency,
          originalDependency: dependency,
        }
      }),
    },
  }
}

function inputDateTime(value: string | null, timezone?: string): string {
  if (!value) return ''
  // An offset-free value already expresses account wall time.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) return value.slice(0, 16)
  const instant = new Date(value)
  if (!Number.isFinite(instant.getTime()) || !timezone) return value.slice(0, 16)
  const local = wallParts(instant, timezone)
  const minutes = Math.round(local.hour * 60)
  return `${local.date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
