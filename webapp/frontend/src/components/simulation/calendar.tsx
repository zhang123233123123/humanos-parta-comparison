'use client'
import FullCalendar from '@fullcalendar/react'
import { type RefObject } from 'react'
import { WorkspaceCalendar } from '@/components/workspace-calendar'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'
import zhLocale from '@fullcalendar/core/locales/zh-cn'
import type { SimRun, SimBlock } from '@/lib/contracts/simulation-contracts'

export function SimulationCalendar({
  run,
  draft,
  onEdit,
  calendarRef,
  workspace = false,
  onSelectTask,
}: {
  run: SimRun
  draft?: SimBlock[]
  onEdit?: (blocks: SimBlock[]) => void
  calendarRef?: RefObject<FullCalendar>
  workspace?: boolean
  onSelectTask?: (taskId: string) => void
}) {
  const blocks =
    draft || run.proposed_plan?.blocks || run.active_plan?.blocks || []
  const edit = (info: {
    event: { id: string; start: Date | null; end: Date | null }
    revert: () => void
  }) => {
    if (
      !onEdit ||
      !info.event.start ||
      !info.event.end ||
      !info.event.id.startsWith('block-')
    ) {
      info.revert()
      return
    }
    const i = Number(info.event.id.slice(6))
    onEdit(
      blocks.map((b, j) =>
        j === i
          ? {
              ...b,
              start_at: info.event.start!.toISOString(),
              end_at: info.event.end!.toISOString(),
            }
          : b,
      ),
    )
  }
  return (
    <WorkspaceCalendar
      ref={calendarRef}
      key={
        workspace
          ? run.id
          : run.id +
            run.simulated_at +
            (run.proposed_plan?.id || run.active_plan?.id || '')
      }
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, luxonPlugin]}
      locale={zhLocale}
      buttonText={{
        today: '今天',
        day: '日',
        week: '周',
        month: '月',
        timeGridWeek: '周',
      }}
      buttonHints={{ prev: '上一个', next: '下一个' }}
      timeZone={run.scenario.timezone}
      initialDate={run.simulated_at}
      now={run.simulated_at}
      nowIndicator
      initialView="timeGridDay"
      height={workspace ? '100%' : 620}
      validRange={{ start: run.scenario.start_at, end: run.scenario.end_at }}
      headerToolbar={
        workspace
          ? false
          : {
              left: 'prev,next',
              center: 'title',
              right: 'timeGridDay,timeGridWeek,dayGridMonth',
            }
      }
      allDaySlot={workspace}
      slotMinTime="00:00:00"
      slotMaxTime="24:00:00"
      scrollTime="08:00:00"
      editable={!!onEdit}
      eventDrop={edit}
      eventResize={edit}
      eventDurationEditable={!!onEdit}
      snapDuration="00:05:00"
      eventClick={(info) => {
        const id = info.event.extendedProps.taskId
        if (id) onSelectTask?.(String(id))
      }}
      events={[
        ...blocks.map((b, i) => ({
          id: 'block-' + i,
          extendedProps: { taskId: b.task_id },
          title:
            b.title ||
            run.scenario.tasks.find((t) => t.id === b.task_id)?.title ||
            b.task_id,
          start: b.start_at,
          end: b.end_at,
          classNames: [
            draft || run.proposed_plan
              ? 'humanos-candidate-event'
              : 'humanos-confirmed-event',
          ],
          backgroundColor: draft || run.proposed_plan ? '#818cf8' : '#4f46e5',
          borderColor: '#4f46e5',
        })),
        ...[...run.scenario.fixed_events, ...(run.unavailable || [])].map(
          (b, i) => ({
            id: 'fixed-' + i,
            title: '固定活动／保护时段',
            start: b.start_at,
            end: b.end_at,
            backgroundColor: '#64748b',
            classNames: ['humanos-fixed-event'],
            editable: false,
          }),
        ),
        ...run.scenario.availability.map((b, i) => ({
          id: 'available-' + i,
          start: b.start_at,
          end: b.end_at,
          display: 'background',
          backgroundColor: '#d1fae5',
          editable: false,
        })),
      ]}
    />
  )
}
