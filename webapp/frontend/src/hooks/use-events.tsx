import { create } from 'zustand'
import { EventInput } from '@fullcalendar/core'
import { toast } from 'sonner'
import { usePlanPreview, planVersion } from './use-plan-preview'
import { draftInstant } from '@/lib/calendar-draft-time'
import { changedPlanBlocks } from '@/lib/calendar-plan-diff'
import { calendarEventClassNames } from '@/lib/calendar-event-state'
import type { PlanBlock, PlanDecision } from '@/lib/contracts/planning-contracts'

function draftDate(weekId: string, dayIndex: number, hour: number) {
  return draftInstant(weekId, dayIndex, hour, usePlanPreview.getState().timezone)
}

async function fetchDraftEvents(): Promise<{ events: EventInput[]; base: PlanDecision | null; weekId?: string }> {
  const [planResponse, activeResponse, taskResponse] = await Promise.all([
    fetch('/api/plans/proposed', { cache: 'no-store' }),
    fetch('/api/plans/active', { cache: 'no-store' }),
    fetch('/api/tasks', { cache: 'no-store' }),
  ])
  if (!planResponse.ok || !activeResponse.ok || !taskResponse.ok) throw new Error('无法读取日历草案，请重试。')
  const planBody = await planResponse.json()
  const activeBody = activeResponse.ok ? await activeResponse.json() : {}
  const taskBody = taskResponse.ok ? await taskResponse.json() : {}
  const stored = usePlanPreview.getState()
  const activePlan = activeBody?.data?.plan || null
  const empty = { events: [], base: activePlan }
  if (stored.original) return empty
  const serverPlan = planBody?.data?.plan
  // The review controller owns refresh/stale handling. In particular, retain the
  // edited proposal after failed saving even if a concurrent read changes.
  const plan = stored.plan || serverPlan
  if (!plan?.week_id || !Array.isArray(plan.plan_patch) || plan.plan_status === 'confirmed'
    || planVersion(plan) === stored.confirmedVersion
    || (activePlan?.plan_status === 'confirmed' && planVersion(plan) === planVersion(activePlan))) return empty
  const changed = changedPlanBlocks(plan, activePlan || null, stored.timezone)
  const tasks = new Map<string, any>((taskBody?.data?.tasks || []).map((task: any) => [String(task.id), task]))
  return { base: activePlan, weekId: plan.week_id, events: plan.plan_patch.flatMap((block: any, index: number) => block.execution_status === 'deferred' ? [] : [{
    id: `draft-${plan.plan_id}-${block.block_id || index}`,
    title: tasks.get(String(block.task_id))?.title || block.title || '未命名活动',
    start: block.start_at || draftDate(String(plan.week_id), Number(block.day_index || 0), Number(block.start || 0)),
    end: block.end_at || draftDate(String(plan.week_id), Number(block.day_index || 0), Number(block.end || block.start || 0)),
    editable: block.kind === 'task_session',
    extendedProps: {
      isDraft: true,
      isChanged: changed[index],
      blockId: block.block_id,
      taskType: block.kind === 'flexible_activity' ? 'flexible_activity' : tasks.get(String(block.task_id))?.task_type,
      status: changed[index] ? 'draft' : 'scheduled',
      taskId: block.task_id,
      planId: plan.plan_id,
      planRevision: plan.plan_revision,
      parallelGroupId: block.parallel_group_id,
      parallelRole: block.parallel_role,
    },
  }]) }
}


export function mergeCalendarDraft(formal: EventInput[], drafts: EventInput[], baseBlocks: Array<Partial<PlanBlock>>, weekId = '', timezone = 'UTC'): EventInput[] {
  if (!drafts.length) return formal.filter(e => !e.extendedProps?.isDraft)
  const blockIds = new Set([...drafts.map(e => e.extendedProps?.blockId), ...baseBlocks.map(b => b.block_id)].filter(Boolean))
  const timingKey = (taskId: unknown, start: unknown, end: unknown) => `${taskId}|${Date.parse(String(start))}|${Date.parse(String(end))}`
  const replacedTimes = new Set(drafts.map(e => timingKey(e.extendedProps?.taskId, e.start, e.end)))
  baseBlocks.forEach(block => {
    try {
      const start = block.start_at || (weekId && draftInstant(weekId, Number(block.day_index), Number(block.start), timezone))
      const end = block.end_at || (weekId && draftInstant(weekId, Number(block.day_index), Number(block.end), timezone))
      if (start && end) replacedTimes.add(timingKey(block.task_id, start, end))
    } catch { /* Invalid legacy timestamps must not hide unrelated formal events. */ }
  })
  return [...formal.filter(e => !e.extendedProps?.isDraft && !blockIds.has(e.extendedProps?.blockId)
    && (e.extendedProps?.blockId || !replacedTimes.has(timingKey(e.extendedProps?.taskId, e.start, e.end)))), ...drafts]
}

type State = {
  events: EventInput[]
  confirmedPresentation: PlanDecision | null
  previousConfirmedVersion: string
  fetchGeneration: number
  currentStart: string
  currentEnd: string
  cachedRanges: { start: string; end: string }[]
}

type Actions = {
  setEvents: (events: EventInput[]) => void
  acknowledgePlan: (plan: PlanDecision) => void
  resetSessionView: () => void
  setCachedRanges: (cachedRanges: { start: string; end: string }[]) => void
  refetchEvents: (start?: string, end?: string) => Promise<void>
  isRangeCached: (start: string, end: string) => boolean
  setCurrentStart: (currentStart: string) => void
  setCurrentEnd: (currentEnd: string) => void
}

export const useEvents = create<State & Actions>((set, get) => ({
  events: [],
  confirmedPresentation: null,
  previousConfirmedVersion: '',
  fetchGeneration: 0,
  cachedRanges: [],
  currentStart: '',
  currentEnd: '',
  setCurrentStart: (currentStart) => set({ currentStart }),
  setCurrentEnd: (currentEnd) => set({ currentEnd }),
  setEvents: (events) => set({ events }),
  resetSessionView: () => set(state => ({
    events: [], confirmedPresentation: null, previousConfirmedVersion: '', cachedRanges: [],
    currentStart: '', currentEnd: '', fetchGeneration: state.fetchGeneration + 1,
  })),
  acknowledgePlan: (plan) => {
    if (plan.plan_status !== 'confirmed' || !plan.plan_id) return
    set(state => ({ confirmedPresentation: plan, previousConfirmedVersion: planVersion(usePlanPreview.getState().base), events: state.events.flatMap(event => {
      const props = event.extendedProps || {}
      if (!props.isDraft || props.planId !== plan.plan_id) return [event]
      const block = plan.plan_patch?.find(item => item.block_id === props.blockId)
      if (Array.isArray(plan.plan_patch) && !block) return []
      const confirmedProps = { ...props, isDraft: false, isPreview: false, isChanged: false, status: 'scheduled', planRevision: plan.plan_revision }
      return [{ ...event,
        ...(block && plan.week_id ? {
          start: block.start_at as string || draftDate(plan.week_id, block.day_index, block.start),
          end: block.end_at as string || draftDate(plan.week_id, block.day_index, block.end),
        } : {}),
        extendedProps: confirmedProps,
        classNames: calendarEventClassNames(confirmedProps),
      }]
    }) }))
  },
  setCachedRanges: (cachedRanges) => set({ cachedRanges }),
  refetchEvents: async (start?: string, end?: string) => {
    const generation = get().fetchGeneration
    try {
      const { currentEnd, currentStart, cachedRanges } = get()
      const acknowledgedAtRequestStart = get().confirmedPresentation

      const rangesToFetch =
        start && end
          ? [{ start, end }]
          : cachedRanges.length > 0
            ? cachedRanges
            : [{ start: currentStart, end: currentEnd }]

      let newEvents: EventInput[] = []

      for (const range of rangesToFetch) {
        const query = new URLSearchParams({ formal_only: '1', start: range.start, end: range.end })
        const response = await fetch(
          `/api/calendar/events?${query.toString()}`,
        )

        if (!response.ok) {
          throw new Error('Failed to fetch events')
        }

        const data = await response.json()
        newEvents = [...newEvents, ...(data.data?.events || [])]
      }

      const draft = await fetchDraftEvents()
      // A new isolated preview session invalidates requests already in flight.
      if (generation !== get().fetchGeneration) return
      // A request begun before the confirmation response cannot replace its UI.
      if (get().confirmedPresentation && get().confirmedPresentation !== acknowledgedAtRequestStart) return
      let applied = false
      set((state) => {
        const overlapsFetchedRange = (event: EventInput) => {
          const eventStart = new Date(event.start as string | Date).getTime()
          const eventEnd = new Date((event.end || event.start) as string | Date).getTime()
          if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd)) return false
          return rangesToFetch.some((range) => {
            const rangeStart = Date.parse(range.start)
            const rangeEnd = Date.parse(range.end)
            return eventStart < rangeEnd && eventEnd > rangeStart
          })
        }

        const retained = state.events.filter((event) => !event.extendedProps?.isDraft && !overlapsFetchedRange(event))
        if (state.confirmedPresentation) {
          const acknowledged = state.confirmedPresentation
          const activeCaughtUp = planVersion(draft.base) === planVersion(acknowledged)
          const visibleConfirmed = state.events.filter(event => event.extendedProps?.planId === acknowledged.plan_id && !event.extendedProps?.isDraft && overlapsFetchedRange(event))
          const sameInstant = (a: unknown, b: unknown) => Date.parse(String(a)) === Date.parse(String(b))
          const calendarCaughtUp = visibleConfirmed.every(event => newEvents.some(incoming =>
            (incoming.extendedProps?.blockId === event.extendedProps?.blockId || incoming.extendedProps?.taskId === event.extendedProps?.taskId)
            && sameInstant(incoming.start, event.start) && sameInstant(incoming.end, event.end)))
          // A read started before the successful save must not repaint the old
          // plan over the acknowledged one. Keep it until formal reads catch up.
          const previousOrMissing = !draft.base || planVersion(draft.base) === state.previousConfirmedVersion
          // A later, different active version is authoritative. This guard is
          // only for the known pre-save plan and incomplete reads of this save.
          if ((!activeCaughtUp && previousOrMissing) || (activeCaughtUp && !calendarCaughtUp)) return state
        }
        const byId = new Map<string, EventInput>()
        const replacementBase = draft.base?.week_id === draft.weekId ? draft.base?.plan_patch || [] : []
        ;mergeCalendarDraft([...retained, ...newEvents], draft.events, replacementBase, draft.base?.week_id, usePlanPreview.getState().timezone).forEach((event) => {
          const key = String(event.id || `${event.title}-${event.start}`)
          byId.set(key, { ...event, classNames: calendarEventClassNames(event.extendedProps || {}) })
        })
        applied = true
        return { events: Array.from(byId.values()), confirmedPresentation: null, previousConfirmedVersion: '' }
      })
      if (!applied) return
      if (start && end) {
        set((state) => {
          const updatedRanges = [...state.cachedRanges]
          const newRange = { start, end }
          if (
            !updatedRanges.some(
              (range) => range.start === start && range.end === end,
            )
          ) {
            updatedRanges.push(newRange)
          }
          return { cachedRanges: updatedRanges }
        })
      }
    } catch (error) {
      if (generation !== get().fetchGeneration) return
      const message = error instanceof Error ? error.message : 'Failed to fetch events'
      toast(message)
      throw error
    }
  },
  isRangeCached: (start: string, end: string) => {
    return get().cachedRanges.some(
      (range) => range.start <= start && range.end >= end,
    )
  },
}))
