'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import luxonPlugin from '@fullcalendar/luxon3'
import FullCalendar from '@fullcalendar/react'
import { WorkspaceCalendar } from '@/components/workspace-calendar'
import { SimulationApp } from '@/components/simulation/app'
import { useSimulationMode } from '@/components/simulation/mode-context'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin, {
  EventResizeDoneArg,
} from '@fullcalendar/interaction'
import { DatesSetArg, EventDropArg } from '@fullcalendar/core'
import CustomHeader from '@/components/custom-header'
import { ExpandableEvent } from '@/components/expandable-event'
import { useModal } from '@/hooks/use-modal'
import { useEvents } from '@/hooks/use-events'
import { findCalendarBlock, moveCalendarBlock } from '@/lib/calendar-session-edit'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/LanguageProvider'
import { WorkspaceGuide } from '@/components/workspace-guide'
import { WorkspaceSidebar } from '@/components/workspace-sidebar'
import Link from 'next/link'
import { CurrentWorkPanel } from '@/components/workspace-runtime/work-panels'
import { localTime } from '@/lib/presentation/task'
import { PendingTaskDetails, type PendingSelection } from '@/components/pending-task-details'
import { CandidatePanel } from '@/components/workspace-runtime/today-state'
import { useInteractionBlock, useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { localDate } from '@/lib/interaction/core'
import { WorkspaceAddTask } from '@/components/workspace-add-task'
import { WorkspaceSessionDetails } from '@/components/workspace-session-details'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { draftInstant, wallParts } from '@/lib/calendar-draft-time'
import { DEMO_MODE } from '@/lib/demo/config'
import { calendarEventClassNames, calendarEventVisualState } from '@/lib/calendar-event-state'
import { DraftBlockDetails } from '@/components/workspace-runtime/calendar-plan-flow'
import { Button } from '@/components/ui/button'
import { Lock, Plus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { apiRequest } from '@/lib/client/api'
import type { PlanDecision, PlanResourceEnvelope } from '@/lib/contracts/planning-contracts'

export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  attendees?: { name: string; avatar?: string }[]
  description?: string
  location?: string
  isFlexible?: boolean
}

function AppContent({
  calendarRef,
  leftOpen,
  setLeftOpen,
  rightOpen,
  setRightOpen,
}: {
  calendarRef: React.RefObject<FullCalendar>
  leftOpen: boolean
  setLeftOpen: (v: boolean) => void
  rightOpen: boolean
  setRightOpen: (v: boolean) => void
}) {
  const {
    events,
    refetchEvents,
    isRangeCached,
    setCurrentStart,
    setCurrentEnd,
    currentEnd,
    currentStart,
  } = useEvents()

  const { t, locale } = useTranslation()
  const { activeEvent, setActiveEvent, setPreviewTasks } = useModal()
  const [pendingCalendarEdit, setPendingCalendarEdit] = useState<{
    taskId: string
    blockId: string | null
    executionSessionId: string | null
    planRevision: number | null
    before: { start: string | null; end: string | null }
    after: { start: string | null; end: string | null }
    eventType: 'move_session' | 'resize_session'
    revert: () => void
  } | null>(null)
  const [calendarEditReason, setCalendarEditReason] = useState('')
  const [savingCalendarEdit, setSavingCalendarEdit] = useState(false)

  const handleDatesSet = useCallback(
    async (arg: DatesSetArg) => {
      const start = arg.startStr
      const end = arg.endStr
      if (start !== currentStart || end !== currentEnd) {
        setCurrentStart(start)
        setCurrentEnd(end)
        if (!isRangeCached(start, end)) {
          await refetchEvents(start, end)
        }
      }
    },
    [isRangeCached, refetchEvents, setCurrentEnd, setCurrentStart, currentStart, currentEnd],
  )

  const handleUpdateEvent = async (event: EventDropArg | EventResizeDoneArg) => {
    if (event.event.extendedProps.isDraft) {
      try {
        const plan = usePlanPreview.getState().plan
        const start = event.event.start, end = event.event.end
        if (!plan?.week_id || !start || !end) throw new Error('Draft unavailable')
        const zone = usePlanPreview.getState().timezone
        const from = wallParts(start, zone), to = wallParts(end, zone)
        const day = Math.round((Date.parse(from.date + 'T00:00:00Z') - Date.parse(plan.week_id + 'T00:00:00Z')) / 86400000)
        const endHour = to.hour + Math.round((Date.parse(to.date + 'T00:00:00Z') - Date.parse(from.date + 'T00:00:00Z')) / 86400000) * 24
        usePlanPreview.getState().edit(String(event.event.extendedProps.blockId), day, from.hour, endHour)
        selectDraft(String(event.event.extendedProps.blockId))
      } catch (error) { event.revert(); toast.error((error as Error).message) }
      return
    }
    if (event.event.extendedProps.isPreview) {
      const nextStart = event.event.start
      const nextEnd = event.event.end
      setPreviewTasks((tasks) => tasks.map((task) => task.uniqueId === event.event.id
        ? { ...task, start: nextStart, end: nextEnd, previewAdjusted: true }
        : task))
      if (activeEvent?.uniqueId === event.event.id) {
        setActiveEvent({ ...activeEvent, start: nextStart, end: nextEnd, previewAdjusted: true })
      }
      return
    }

    if (pendingCalendarEdit) {
      event.revert()
      toast(locale === 'zh' ? '请先保存或取消当前拖拽修改' : 'Save or cancel the current calendar edit first')
      return
    }

    const oldEvent = event.oldEvent
    setPendingCalendarEdit({
      taskId: String(event.event.extendedProps.taskId || event.event.id),
      blockId: event.event.extendedProps.blockId ? String(event.event.extendedProps.blockId) : null,
      executionSessionId: event.event.extendedProps.executionSessionId ? String(event.event.extendedProps.executionSessionId) : null,
      planRevision: Number.isFinite(Number(event.event.extendedProps.planRevision)) ? Number(event.event.extendedProps.planRevision) : null,
      before: { start: oldEvent.start?.toISOString() || null, end: oldEvent.end?.toISOString() || null },
      after: { start: event.event.start?.toISOString() || null, end: event.event.end?.toISOString() || null },
      eventType: 'oldEvent' in event && event.event.start?.getTime() === oldEvent.start?.getTime()
        ? 'resize_session'
        : 'move_session',
      revert: () => event.revert(),
    })
  }

  const cancelCalendarEdit = () => {
    pendingCalendarEdit?.revert()
    setPendingCalendarEdit(null)
    setCalendarEditReason('')
  }

  const saveCalendarEdit = async () => {
    if (!pendingCalendarEdit || savingCalendarEdit) return
    setSavingCalendarEdit(true)
    const reason = calendarEditReason.trim()
    try {
      const active = await apiRequest<PlanResourceEnvelope<{ plan: PlanDecision | null }>>('/api/plans/active')
      const basePlan = active.data.plan
      const basePatch = basePlan?.plan_patch || []
      const activeRevision = Number(basePlan?.plan_revision)
      if (pendingCalendarEdit.planRevision !== null && activeRevision !== pendingCalendarEdit.planRevision) {
        throw new Error(locale === 'zh' ? '计划已更新，请刷新后重新拖拽' : 'The plan changed. Refresh and drag the session again.')
      }
      const originalBlock = pendingCalendarEdit.blockId
        ? findCalendarBlock(basePatch, pendingCalendarEdit.blockId)
        : undefined

      if (basePlan?.plan_id && pendingCalendarEdit.blockId) {
        if (!originalBlock) throw new Error(locale === 'zh' ? '找不到被拖动的时间块，请刷新后重试' : 'The moved session no longer exists. Refresh and try again.')
        const revisedResult = await apiRequest<PlanResourceEnvelope<{ plan: PlanDecision }>>('/api/plans/revise', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan_id: basePlan.plan_id, request_id: `drag-${Date.now()}` }),
        })
        const revised = revisedResult.data.plan
        const nextStart = new Date(pendingCalendarEdit.after.start || '')
        const nextEnd = new Date(pendingCalendarEdit.after.end || '')
        const nextPatch = moveCalendarBlock(revised.plan_patch || [], pendingCalendarEdit.blockId, nextStart, nextEnd)
        await apiRequest('/api/plan-edits/events', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            edit_episode_id: revised.edit_episode_id,
            task_id: pendingCalendarEdit.taskId,
            block_id: pendingCalendarEdit.blockId,
            execution_session_id: pendingCalendarEdit.executionSessionId,
            event_type: pendingCalendarEdit.eventType,
            before: pendingCalendarEdit.before,
            after: pendingCalendarEdit.after,
            interaction_source: 'calendar_drag',
            request_id: `edit-${Date.now()}`,
          }),
        })
        const validationResult = await apiRequest<any>('/api/schedules/validate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...revised, plan_patch: nextPatch }),
        })
        const validation = validationResult.validation || validationResult
        if (validation.valid === false) throw new Error(validation.violations?.[0]?.message || 'This time conflicts with the plan constraints')
        await apiRequest('/api/schedules/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_id: revised.plan_id,
            week_id: revised.week_id,
            edit_episode_id: revised.edit_episode_id,
            decision: revised,
            plan_patch: nextPatch,
            unscheduled_tasks: revised.unscheduled_tasks || [],
            rationale: {
              reason_codes: reason ? ['user_reported_schedule_change'] : [],
              raw_user_response: reason,
              parsed_reason: { raw_text: reason, reason_codes: reason ? ['user_reported_schedule_change'] : [] },
              affected_task_ids: [pendingCalendarEdit.taskId],
              response_status: reason ? 'answered' : 'skipped',
              generalizability: 'not_sure',
              request_id: `rationale-${Date.now()}`,
            },
          }),
        })
        window.dispatchEvent(new CustomEvent('humanos:plan-updated', {
          detail: { source: 'calendar-drag-confirmation' },
        }))
      } else {
        await apiRequest('/api/tasks', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: pendingCalendarEdit.taskId,
            start: pendingCalendarEdit.after.start,
            end: pendingCalendarEdit.after.end,
            context_window: {
              last_schedule_change: {
                before: pendingCalendarEdit.before,
                after: pendingCalendarEdit.after,
                reason,
                response_status: reason ? 'answered' : 'skipped',
                interaction_source: 'calendar_drag',
              },
            },
          }),
        })
      }
      if (activeEvent && String(activeEvent.taskId || activeEvent.id) === pendingCalendarEdit.taskId && activeEvent.start?.toISOString() === pendingCalendarEdit.before.start) {
        setActiveEvent({ ...activeEvent, start: new Date(pendingCalendarEdit.after.start!), end: new Date(pendingCalendarEdit.after.end!) })
      }
      setPendingCalendarEdit(null)
      setCalendarEditReason('')
      await refetchEvents(currentStart, currentEnd)
      toast(t('event.eventUpdated'))
    } catch (error) {
      pendingCalendarEdit.revert()
      setPendingCalendarEdit(null)
      setCalendarEditReason('')
      await refetchEvents(currentStart, currentEnd).catch(() => undefined)
      toast(error instanceof Error ? error.message : 'Failed to save calendar change')
    } finally {
      setSavingCalendarEdit(false)
    }
  }

  useInteractionBlock('calendar-edit-confirmation', Boolean(pendingCalendarEdit))
  const runtime = useWorkspaceRuntime()
  const draftSelection = usePlanPreview(s => s.selected)
  const draftStale = usePlanPreview(s => s.stale)
  const [rightTab, setRightTab] = useState<'candidate' | 'tasks' | 'add'>('candidate')
  const [homeMode, setHomeMode] = useState<'auto' | 'current' | 'pending'>('auto')
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null)
  const [guideStep, setGuideStep] = useState<number | null>(null)
  useEffect(function installDemoScenarioListener() {
    if (!DEMO_MODE) return
    const applyFixture = (detail: { fixture_loaded?: boolean; source_session_id?: string; local_date?: string } | undefined) => {
      if (!detail?.fixture_loaded || !detail.source_session_id || !/^\d{4}-\d{2}-\d{2}$/.test(detail.local_date || '')) return
      try { window.sessionStorage.removeItem('humanos:demo-feedback-workspace') } catch { /* The event is sufficient on the mounted workspace. */ }
      pendingCalendarEdit?.revert()
      setPendingCalendarEdit(null); setCalendarEditReason(''); setSavingCalendarEdit(false)
      setActiveEvent(null); setPreviewTasks([]); setRightTab('candidate'); setPendingSelection(null); setRightOpen(true); setGuideStep(null); setHomeMode('auto')
      const preview = usePlanPreview.getState()
      preview.clear()
      usePlanPreview.setState({ base: null, original: false, storageKey: '', stateId: null, titles: {}, tasks: {}, confirmedVersion: '' })
      const calendarState = useEvents.getState()
      calendarState.resetSessionView()
      const calendar = calendarRef.current?.getApi()
      calendar?.gotoDate(detail.local_date!)
      const start = calendar?.view.activeStart.toISOString() || draftInstant(detail.local_date!, 0, 0, preview.timezone)
      const end = calendar?.view.activeEnd.toISOString() || draftInstant(detail.local_date!, 1, 0, preview.timezone)
      calendarState.setCurrentStart(start); calendarState.setCurrentEnd(end)
      // refetchEvents already reports read errors; fixture preparation itself is
      // never presented as a calendar save or a successful feedback submission.
      void calendarState.refetchEvents(start, end).catch(() => undefined)
    }
    const receive = (event: Event) => applyFixture((event as CustomEvent).detail)
    window.addEventListener('humanos:demo-feedback-scenario', receive)
    try { applyFixture(JSON.parse(window.sessionStorage.getItem('humanos:demo-feedback-workspace') || 'null')) } catch { /* Ignore an incomplete navigation handoff. */ }
    return () => window.removeEventListener('humanos:demo-feedback-scenario', receive)
  }, [calendarRef, pendingCalendarEdit, setActiveEvent, setPreviewTasks, setRightOpen])
  const openGuideStep = useCallback((next: number | null) => {
    setGuideStep(next)
    if (next !== null) setLeftOpen(true)
    if (next === 0 || next === 5) { setActiveEvent(null); usePlanPreview.getState().select(''); setRightOpen(true); setRightTab('candidate'); setPendingSelection(null) }
  }, [setLeftOpen, setRightOpen, setActiveEvent])
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('guide') !== 'workspace' || !runtime?.snapshot?.profile.onboarding_completed) return
    openGuideStep(0)
    url.searchParams.delete('guide')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [openGuideStep, runtime?.snapshot?.profile.onboarding_completed])

  useEffect(() => { if (activeEvent) { setPendingSelection(null); usePlanPreview.getState().select(''); setRightTab('tasks'); setRightOpen(true) } }, [activeEvent, setRightOpen])
  useEffect(() => { if (draftSelection) { setRightTab('tasks'); setRightOpen(true) } }, [draftSelection, setRightOpen])
  useEffect(() => { const frame = requestAnimationFrame(() => calendarRef.current?.getApi().updateSize()); return () => cancelAnimationFrame(frame) }, [leftOpen, rightOpen, calendarRef])
  const selectDraft = (blockId: string) => {
    if (!usePlanPreview.getState().plan?.plan_patch.some(b => b.block_id === blockId)) { toast.error(locale === 'zh' ? '候选计划尚未读取完成，请稍后再试。' : 'The candidate is still loading. Please retry.'); return }
    setActiveEvent(null); usePlanPreview.getState().select(blockId); setRightTab('tasks'); setRightOpen(true)
    if (window.matchMedia('(max-width: 1000px)').matches) setLeftOpen(false)
  }


  useEffect(() => {
    const show = () => { setActiveEvent(null); usePlanPreview.getState().select(''); setRightTab('candidate'); setPendingSelection(null); setHomeMode('current'); setRightOpen(true) }
    const reload = () => { void refetchEvents().catch(() => undefined) }
    window.addEventListener('humanos:daily-state-saved', reload)
    window.addEventListener('humanos:plan-updated', reload)
    const pending = (event: Event) => { show(); setHomeMode('pending'); const selection = (event as CustomEvent<PendingSelection>).detail; if (selection?.taskId) setPendingSelection(selection) }
    const browse = () => { show(); setHomeMode('pending') }
    window.addEventListener('humanos:pending-work', pending)
    window.addEventListener('humanos:browse-work', browse)
    window.addEventListener('humanos:current-work', show)
    return () => { window.removeEventListener('humanos:pending-work', pending); window.removeEventListener('humanos:browse-work', browse); window.removeEventListener('humanos:current-work', show); window.removeEventListener('humanos:daily-state-saved', reload); window.removeEventListener('humanos:plan-updated', reload) }
  }, [setActiveEvent, setRightOpen])
  const returnToPending = () => { setActiveEvent(null); usePlanPreview.getState().select(''); setRightTab('candidate'); setPendingSelection(null) }
  const showingCurrent = rightTab !== 'add' && !draftSelection && !activeEvent && !pendingSelection && Boolean(runtime?.activeWork) && (homeMode === 'current' || homeMode === 'auto')
  const simultaneousEvents = pendingCalendarEdit ? events.filter(event => {
    const props=event.extendedProps || {}
    if(props.isDraft || props.isPreview || pendingCalendarEdit.blockId && props.blockId===pendingCalendarEdit.blockId || pendingCalendarEdit.executionSessionId && props.executionSessionId===pendingCalendarEdit.executionSessionId) return false
    const start=new Date(String(event.start || '')).getTime(),end=new Date(String(event.end || '')).getTime()
    if(String(props.taskId || event.id)===pendingCalendarEdit.taskId && start===Date.parse(pendingCalendarEdit.before.start || ''))return false
    return start<Date.parse(pendingCalendarEdit.after.end || '') && end>Date.parse(pendingCalendarEdit.after.start || '')
  }) : []
  const selectedCalendarEvent = activeEvent ? events.find(event => {
    const props = event.extendedProps || {}
    return !props.isDraft && (activeEvent.executionSessionId
      ? props.executionSessionId === activeEvent.executionSessionId
      : String(props.taskId || event.id) === String(activeEvent.taskId || activeEvent.id) && new Date(String(event.start || '')).getTime() === activeEvent.start?.getTime())
  }) : undefined
  const previewSelectedTime = (start: Date, end: Date) => {
    if (!activeEvent?.start || !activeEvent.end || !selectedCalendarEvent || pendingCalendarEdit) return
    const props = selectedCalendarEvent.extendedProps || {}
    setPendingCalendarEdit({
      taskId: String(props.taskId || activeEvent.taskId || activeEvent.id),
      blockId: props.blockId ? String(props.blockId) : null,
      executionSessionId: props.executionSessionId ? String(props.executionSessionId) : null,
      planRevision: Number.isFinite(Number(props.planRevision)) ? Number(props.planRevision) : null,
      before: { start: activeEvent.start.toISOString(), end: activeEvent.end.toISOString() },
      after: { start: start.toISOString(), end: end.toISOString() },
      eventType: start.getTime() === activeEvent.start.getTime() ? 'resize_session' : 'move_session',
      revert: () => {},
    })
  }


  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {guideStep !== null && <WorkspaceGuide step={guideStep} locale={locale} onStep={openGuideStep} />}
      {/* Top bar */}
      <div className="shrink-0">
        <CustomHeader calendarRef={calendarRef} onOpenGuide={() => openGuideStep(0)} />
      </div>

      {/* Three-column layout */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div id="workspace-guide-input" className={leftOpen ? `flex shrink-0 ${guideStep === 0 ? 'ring-2 ring-inset ring-blue-500' : ''}` : 'hidden'}>
          <WorkspaceSidebar />
        </div>

        <button type="button" onClick={() => { setLeftOpen(!leftOpen); if (!leftOpen && window.matchMedia('(max-width: 767px)').matches) setRightOpen(false) }} aria-expanded={leftOpen} aria-controls="workspace-guide-input"
          aria-label={leftOpen ? '收起今日状态' : '展开今日状态'} title={leftOpen ? '收起今日状态' : '展开今日状态'}
          className="z-40 flex w-5 shrink-0 items-center justify-center border-r bg-muted/20 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          {leftOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>

        {/* Calendar center */}
        <div id="workspace-guide-calendar" tabIndex={-1} className="h-full min-h-0 min-w-0 flex-1 overflow-hidden px-2 pb-2 pt-1">
          <WorkspaceCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
            timeZone={runtime?.snapshot?.profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone}
            initialView="timeGridDay"
            headerToolbar={false}
            slotMinTime="00:00:00"
            slotMaxTime="24:00:00"
            slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            allDaySlot={true}
            events={events}
            height="100%"
            expandRows
            views={{
              timeGridWeek: {
                duration: { days: 7 },
                dateAlignment: 'day',
                titleFormat: { year: 'numeric', month: 'short' },
                dayHeaderFormat: { weekday: 'short', day: 'numeric' },
              },
              timeGridDay: {
                titleFormat: { year: 'numeric', month: 'short' },
                dayHeaderFormat: { weekday: 'long', day: 'numeric' },
              },
            }}
            dayHeaderContent={(arg: any) => {
              const language = locale === 'zh' ? 'zh-CN' : 'en-GB'
              const weekday = arg.date.toLocaleDateString(language, { timeZone: runtime?.snapshot?.profile.timezone, weekday: 'short' }).replace('.', '')
              if (arg.view.type === 'dayGridMonth') return <span>{weekday}</span>
              const date = arg.date.toLocaleDateString(language, { timeZone: runtime?.snapshot?.profile.timezone, month: 'long', day: 'numeric' })
              return <span className="humanos-day-heading">{weekday} · {date}</span>
            }}
            buttonText={{
              today: t('header.today'),
              month: t('header.month'),
              week: t('header.week'),
              day: t('header.day'),
            }}
            nowIndicator
            now={new Date(runtime?.now || Date.now())}
            selectable={false}
            datesSet={handleDatesSet}
            dayMaxEvents={3}
            moreLinkClick="popover"
            eventClassNames={arg => calendarEventClassNames(arg.event.extendedProps, draftSelection)}
            eventClick={arg => { if (arg.event.extendedProps.isDraft) selectDraft(String(arg.event.extendedProps.blockId)) }}
            eventContent={function renderEventContent(arg) {
              const visualState = calendarEventVisualState(arg.event.extendedProps)
              const fixedMarker = visualState === 'fixed' ? <span className="humanos-fixed-marker" title={locale === 'zh' ? '固定时间，系统不会自动移动' : 'Fixed time; not moved automatically'}><Lock className="h-3 w-3" aria-hidden="true" /><span className="sr-only">{locale === 'zh' ? '固定活动' : 'Fixed event'}</span></span> : null
              if (arg.event.extendedProps.isDraft) {
                return <button type="button" aria-pressed={String(arg.event.extendedProps.blockId) === draftSelection} aria-label={`${visualState === 'candidate' ? '查看待确认工作段' : visualState === 'fixed' ? '查看固定活动' : '查看工作段'}：${arg.event.title} ${arg.timeText}`} title={visualState === 'fixed' ? '点击查看固定活动；系统不会自动移动' : arg.event.extendedProps.taskType === 'flexible_activity' ? '点击查看活动' : '点击查看详情；拖动或拉伸调整时段'} className={`humanos-event-content block h-full w-full cursor-pointer overflow-hidden px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset ${visualState === 'fixed' ? 'focus-visible:ring-muted-foreground' : 'focus-visible:ring-primary'}`} onClick={e => { e.stopPropagation(); selectDraft(String(arg.event.extendedProps.blockId)) }}><span className="mb-0.5 flex items-center gap-1">{fixedMarker}<span className="truncate font-medium">{arg.event.title}</span>{visualState === 'candidate' && <span className="humanos-event-status">待确认</span>}</span><span>{arg.timeText}</span></button>
              }
              if (arg.event.extendedProps.taskType === 'flexible_activity') {
                return <Link href="/app/settings/profile" className="humanos-event-content block h-full overflow-hidden px-1 text-xs" title={locale === 'zh' ? '修改活动设置' : 'Edit activity settings'}>{arg.timeText} {arg.event.title}{visualState === 'candidate' && <span className="humanos-event-status">待确认</span>}</Link>
              }
              if (arg.view.type === 'dayGridMonth') {
                const isPreview = Boolean(arg.event.extendedProps.isPreview)
                return (
                  <button
                    type="button"
                    className="humanos-event-content flex w-full min-w-0 items-center gap-1 overflow-hidden rounded px-1.5 py-0.5 text-left text-[11px] leading-4"
                    onClick={() => setActiveEvent({
                      id: String(arg.event.extendedProps.taskId || arg.event.id),
                      uniqueId: isPreview ? arg.event.id : `${arg.event.id}-${arg.event.start?.toISOString()}`,
                      title: arg.event.title,
                      start: arg.event.start,
                      end: arg.event.end,
                      allDay: arg.event.allDay,
                      timeText: arg.timeText,
                      description: arg.event.extendedProps.description || '',
                      attendees: arg.event.extendedProps.attendees || [],
                      status: arg.event.extendedProps.status || 'scheduled',
                      priority: arg.event.extendedProps.priority || 'medium',
                      isPreview,
                      context: arg.event.extendedProps.context || '',
                      progress: arg.event.extendedProps.progress || '',
                      nextStep: arg.event.extendedProps.nextStep || '',
                      openQuestions: arg.event.extendedProps.openQuestions || '',
                      taskType: arg.event.extendedProps.taskType,
                      start_at: arg.event.extendedProps.start_at,
                      duration: arg.event.extendedProps.duration,
                      deadline_at: arg.event.extendedProps.deadline_at,
                      expectedDifficulty: arg.event.extendedProps.expectedDifficulty,
                      dependency: arg.event.extendedProps.dependency,
                      resourceModality: arg.event.extendedProps.resourceModality,
                      attentionMode: arg.event.extendedProps.attentionMode,
                      parallelizable: arg.event.extendedProps.parallelizable,
                      fieldSources: arg.event.extendedProps.fieldSources,
                      fieldProvenance: arg.event.extendedProps.fieldProvenance,
                      executionSessionId: arg.event.extendedProps.executionSessionId,
                      planRevision: arg.event.extendedProps.planRevision,
                    })}
                  >
                    {fixedMarker}
                    {arg.timeText && <span className="shrink-0 opacity-70">{arg.timeText}</span>}
                    <span className="truncate">{arg.event.title}</span>
                    {visualState === 'candidate' && <span className="humanos-event-status">待确认</span>}
                  </button>
                )
              }
              return <ExpandableEvent {...arg} />
            }}
            editable={true}
            eventAllow={(_drop, dragged) => !dragged?.extendedProps.isDraft || !draftStale}
            eventDrop={handleUpdateEvent}
            eventResize={handleUpdateEvent}
          />
        </div>

        <button type="button" onClick={() => { setRightOpen(!rightOpen); if (!rightOpen && window.matchMedia('(max-width: 767px)').matches) setLeftOpen(false) }} aria-expanded={rightOpen} aria-controls="workspace-guide-review"
          aria-label={rightOpen ? '收起任务面板' : '展开任务面板'} title={rightOpen ? '收起任务面板' : '展开任务面板'}
          className="z-40 flex w-5 shrink-0 items-center justify-center border-l bg-muted/20 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          {rightOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </button>

        {/* Right Inspector */}
        {rightOpen && <div id="workspace-guide-review" tabIndex={-1} className={`flex w-[292px] shrink-0 flex-col overflow-hidden border-l bg-background ${guideStep !== null && guideStep > 0 && guideStep < 4 ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
          <div id="workspace-guide-candidate" className="shrink-0 border-b px-3 py-2.5">
            <div className="mb-2 flex gap-1" role="group" aria-label={locale==='zh'?'工作面板':'Work panel'}>{(['current','pending'] as const).map(mode=><Button key={mode} size="sm" variant={(mode==='current'?showingCurrent:!showingCurrent && !activeEvent && !draftSelection && !pendingSelection && rightTab!=='add')?'secondary':'ghost'} onClick={()=>{returnToPending();setHomeMode(mode)}}>{locale==='zh'?(mode==='current'?'当前工作':'待安排'):(mode==='current'?'Current work':'To schedule')}</Button>)}<div className="ml-auto"><Button id="workspace-guide-add-task" size="sm" variant="ghost" className="h-7 px-1.5 text-xs" disabled={Boolean(runtime?.blocked || runtime?.overlay)} onClick={() => { setActiveEvent(null); usePlanPreview.getState().select(''); setRightTab('add') }}><Plus className="mr-1 h-3.5 w-3.5" />{locale === 'zh' ? '新增任务' : 'Add task'}</Button></div></div>
            {runtime?.activeWork && !showingCurrent && <button className="mb-2 w-full truncate rounded-lg bg-primary/5 px-2 py-2 text-left text-xs text-primary" onClick={()=>{returnToPending();setHomeMode('current')}}>{runtime.activeWork.status==='paused'?(locale==='zh'?'已暂停':'Paused'):(locale==='zh'?'进行中':'In progress')} · {runtime.activeWork.title}</button>}
            {rightTab === 'add' || draftSelection || activeEvent || pendingSelection ? <div className="grid gap-2">
              <Button variant="ghost" size="sm" className="h-7 justify-self-start px-1 text-muted-foreground" onClick={()=>{returnToPending();setHomeMode(runtime?.activeWork?'current':'pending')}}>{runtime?.activeWork ? (locale === 'zh' ? '← 返回当前工作' : '← Back to current work') : (locale === 'zh' ? '← 返回待安排' : '← Back to pending')}</Button>
              <h2 className="text-sm font-semibold">{locale === 'zh' ? (rightTab === 'add' ? '新增任务' : pendingSelection && !draftSelection && !activeEvent ? '待安排任务详情' : '工作段详情') : (rightTab === 'add' ? 'Add task' : pendingSelection && !draftSelection && !activeEvent ? 'Pending task details' : 'Session details')}</h2>
            </div> : null}
          </div>
          {rightTab === 'add' ? <WorkspaceAddTask onClose={()=>{returnToPending();setHomeMode('pending')}} /> : draftSelection ? <DraftBlockDetails /> : activeEvent ? <WorkspaceSessionDetails selection={activeEvent} event={selectedCalendarEvent} onAdjust={previewSelectedTime} /> : pendingSelection ? <PendingTaskDetails selection={pendingSelection} /> : showingCurrent ? <CurrentWorkPanel /> : <CandidatePanel onSelect={setPendingSelection} />}
        </div>}
      </div>
      {pendingCalendarEdit && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-label={locale==='zh'?'确认调整日程':'Confirm calendar change'} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border bg-background p-5 shadow-2xl">
            <h3 className="text-lg font-semibold">{locale === 'zh' ? '确认调整日程？' : 'Confirm calendar change?'}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{locale === 'zh' ? '确认后更新这一段的时间。' : 'Confirm to update this session’s time.'}</p>
            <dl className="mt-3 space-y-2 rounded-lg border p-3 text-sm">
              {(['before', 'after'] as const).map(side => <div key={side}>
                <dt className="text-muted-foreground">{side === 'before' ? (locale === 'zh' ? '原时间' : 'Original time') : (locale === 'zh' ? '新时间（待确认）' : 'New time (unconfirmed)')}</dt>
                <dd>{[pendingCalendarEdit[side].start, pendingCalendarEdit[side].end].map(value => value ? localTime(value,runtime?.snapshot?.profile.timezone || 'UTC',locale) : '—').join(' → ')}</dd>
              </div>)}
            </dl>
            {simultaneousEvents.length>0 && <div className="mt-3 rounded-lg border border-amber-300 p-3 text-sm"><p className="font-medium">{locale==='zh'?'该时段还有以下安排':'Other arrangements at this time'}</p>{simultaneousEvents.map((event,index)=><p key={index} className="mt-1">{event.title} · {localTime(String(event.start),runtime?.snapshot?.profile.timezone || 'UTC',locale,'time')}–{localTime(String(event.end),runtime?.snapshot?.profile.timezone || 'UTC',locale,'time')}</p>)}</div>}
            <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">{locale==='zh'?'原因（可选）':'Reason (optional)'}</summary><input className="mt-2 h-10 w-full rounded-md border bg-background px-3" value={calendarEditReason} onChange={e=>setCalendarEditReason(e.target.value)} maxLength={240}/></details>
            <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={cancelCalendarEdit} disabled={savingCalendarEdit}>{locale === 'zh' ? '取消并恢复' : 'Cancel and restore'}</Button><Button onClick={() => void saveCalendarEdit()} disabled={savingCalendarEdit}>{savingCalendarEdit ? (locale === 'zh' ? '正在校验并保存…' : 'Validating and saving…') : (locale === 'zh' ? '确认并保存' : 'Confirm and save')}</Button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProductionWorkspace() {
  const runtime = useWorkspaceRuntime()
  const navigatedAccount = useRef<string | null>(null)
  const calendarRef = useRef<FullCalendar>(null)
  useEffect(() => {
    if (!runtime?.snapshot || navigatedAccount.current === runtime.snapshot.profile.user_id) return
    const api = calendarRef.current?.getApi(); if (!api) return
    api.gotoDate(localDate(runtime.now, runtime.snapshot.profile.timezone))
    navigatedAccount.current = runtime.snapshot.profile.user_id
  }, [runtime?.snapshot, runtime?.now])
  useEffect(() => {
    const navigate = (event: Event) => {
      const week = (event as CustomEvent<{ week: string }>).detail?.week
      if (week) calendarRef.current?.getApi().gotoDate(week)
    }
    window.addEventListener('humanos:navigate-week', navigate)
    return () => window.removeEventListener('humanos:navigate-week', navigate)
  }, [])
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) { setLeftOpen(false); setRightOpen(false) }
  }, [])


  useEffect(() => { if (runtime?.activeWork && window.matchMedia('(max-width: 767px)').matches) { setLeftOpen(false); setRightOpen(true) } }, [runtime?.activeWork?.id])
  return <AppContent calendarRef={calendarRef} leftOpen={leftOpen} setLeftOpen={setLeftOpen} rightOpen={rightOpen} setRightOpen={setRightOpen} />
}

export default function WorkspacePage() {
  const simulation = useSimulationMode()
  return simulation ? <SimulationApp path={[]} /> : <ProductionWorkspace />
}
