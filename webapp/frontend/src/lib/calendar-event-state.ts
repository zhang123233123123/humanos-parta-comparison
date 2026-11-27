type CalendarEventProps = Record<string, unknown>

/** Draft membership permits editing; only changed/new blocks are pending. */
export function calendarEventVisualState(props: CalendarEventProps): 'candidate' | 'confirmed' | 'fixed' {
  if (['fixed_event', 'fixed_activity', 'recurring_routine'].includes(String(props.taskType)) || props.kind === 'fixed_event') return 'fixed'
  if (props.isDraft ? props.isChanged !== false : props.isPreview) return 'candidate'
  return 'confirmed'
}

export function calendarEventClassNames(props: CalendarEventProps, selectedBlockId = ''): string[] {
  const state = calendarEventVisualState(props)
  return [
    `humanos-${state}-event`,
    ...(selectedBlockId && String(props.blockId) === selectedBlockId ? ['humanos-event-selected'] : []),
  ]
}
