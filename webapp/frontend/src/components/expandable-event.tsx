import { EventContentArg } from '@fullcalendar/core/index.js'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useModal } from '@/hooks/use-modal'
import { toast } from 'sonner'
import { useEvents } from '@/hooks/use-events'
import { useTranslation } from '@/i18n/LanguageProvider'
import { apiRequest } from '@/lib/client/api'
import type { HumanOSMapEventInput } from '@/lib/contracts/task-contracts'
import { calendarEventVisualState } from '@/lib/calendar-event-state'
import { Lock } from 'lucide-react'

type ExtendedProps = HumanOSMapEventInput['extendedProps']

export function ExpandableEvent(props: EventContentArg) {
  const { event, isPast, timeText, isDragging } = props
  const { setActiveEvent } = useModal()
  const { refetchEvents } = useEvents()
  const { t, locale } = useTranslation()
  const visualState = calendarEventVisualState(event.extendedProps)

  const isPreview = (event.extendedProps as any)?.isPreview || false
  const isSmallThen1Hour =
    (event.end?.getTime() || 0) - (event.start?.getTime() || 0) < 3600001
  const isSmallThen30Minutes =
    (event.end?.getTime() || 0) - (event.start?.getTime() || 0) < 1800001

  const uniqueId = isPreview
    ? event.id
    : `${event.id || event.title}-${event.start?.toISOString()}`

  const handleDeleteEvent = async () => {
    const eventData = {
      id: String(event.extendedProps.taskId || event.id),
    }

    await apiRequest('/api/tasks', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventData),
    })

    await refetchEvents()
    toast(t('event.eventDeleted'))
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          onClick={() =>
            setActiveEvent({
              id: String(event.extendedProps.taskId || event.id),
              title: event.title,
              uniqueId,
              allDay: event.allDay,
              start: event.start,
              end: event.end,
              timeText,
              ...(event.extendedProps as ExtendedProps),
            })
          }
          className={cn(
            'humanos-event-content w-full h-full overflow-hidden p-[0.5px] rounded-md cursor-pointer',
            {
              'cursor-grabbing': isDragging,
            },
          )}
        >
          <div
            className={cn(
              'flex w-full h-full rounded-md relative',
              {
                'opacity-50': isPast && visualState !== 'fixed',
              },
            )}
          >
            <div
              className={cn('w-full h-full', {
                'px-2': isSmallThen1Hour,
                'flex gap-2 items-center': isSmallThen30Minutes,
                'p-2': !isSmallThen1Hour,
              })}
            >
              <p
                className={cn(
                  'flex min-w-0 items-center gap-1 font-medium',
                  {
                    'text-base': !isSmallThen1Hour,
                    'text-sm': isSmallThen1Hour,
                    'text-xs': isSmallThen30Minutes,
                  },
                )}
              >
                {visualState === 'fixed' && <span className="humanos-fixed-marker" title={locale === 'zh' ? '固定时间，系统不会自动移动' : 'Fixed time; not moved automatically'}><Lock className="h-3 w-3" aria-hidden="true" /><span className="sr-only">{locale === 'zh' ? '固定活动' : 'Fixed event'}</span></span>}
                <span className="truncate">{event.title}</span>
              </p>
              {visualState === 'candidate' && <span className="humanos-event-status">{locale === 'zh' ? '待确认' : 'Pending'}</span>}
              {!isSmallThen30Minutes && (
                <p className="text-xs truncate opacity-80">
                  {timeText}
                </p>
              )}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {!isPreview && (
          <ContextMenuItem onClick={handleDeleteEvent}>
            {t('event.deleteEvent')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
