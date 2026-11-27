'use client'

import { forwardRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import type { CalendarOptions } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'

/** Shared calendar surface for the existing workspace and its isolated simulation adapter. */
export const WorkspaceCalendar = forwardRef<FullCalendar, CalendarOptions>(
  function WorkspaceCalendar(props, ref) {
    return (
      <FullCalendar
        ref={ref}
        plugins={[
          dayGridPlugin,
          timeGridPlugin,
          interactionPlugin,
          luxonPlugin,
        ]}
        initialView="timeGridDay"
        headerToolbar={false}
        height="100%"
        expandRows
        slotMinTime="00:00:00"
        slotMaxTime="24:00:00"
        slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
        allDaySlot
        nowIndicator
        selectable={false}
        dayMaxEvents={3}
        moreLinkClick="popover"
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
        {...props}
      />
    )
  },
)
