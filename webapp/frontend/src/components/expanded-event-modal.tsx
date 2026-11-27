'use client'
import { TaskDetailsLink } from '@/components/task-details-link'
import { SessionActions } from '@/components/workspace-runtime/overlays'
import { useInteractionBlock } from '@/components/workspace-runtime/provider'
import { useRef, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useOutsideClick } from '@/hooks/use-outside-click'
import { useModal } from '@/hooks/use-modal'
import { useEvents } from '@/hooks/use-events'
import { format, isSameDay } from 'date-fns'
import { AnimatedTooltip } from '@/components/ui/animated-tooltip'
import { Button } from '@/components/ui/button'
import { TaskDialog } from '@/components/task-dialog'
import { Clock, Text, Users, Pencil, Trash2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { useTranslation } from '@/i18n/LanguageProvider'
import { toast } from 'sonner'
import { apiRequest } from '@/lib/client/api'
import Link from 'next/link'

export function ExpandedEventModal() {
  const { activeEvent, setActiveEvent } = useModal()
  useInteractionBlock('expanded-event-modal', Boolean(activeEvent))
  const { refetchEvents } = useEvents()
  const { t, locale } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [taskDialogOpen, setTaskDialogOpen] = useState(false)

  useOutsideClick(ref, () => setActiveEvent(null))

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveEvent(null)
      }
    }

    if (activeEvent) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'auto'
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeEvent, setActiveEvent])

  function formatDateRange(startDate: Date, endDate: Date): string {
    const formatDate = (date: Date): string => format(date, "EEEE, d 'de' MMMM")
    const formatTime = (date: Date): string => format(date, 'H:mm')

    const startFormatted: string = formatDate(startDate)
    const startTime: string = formatTime(startDate)
    const endTime: string = formatTime(endDate)

    if (isSameDay(startDate, endDate)) {
      return `${startFormatted}⋅${startTime} - ${endTime}`
    } else {
      const endFormatted: string = formatDate(endDate)
      return `${startFormatted} ${startTime} - ${endFormatted} ${endTime}`
    }
  }

  if (!activeEvent) return null

  const taskId = activeEvent.taskId || activeEvent.id

  const pureText = (htmlString: string) => {
    return htmlString.replace(/<[^>]*>/g, '')
  }

  const handleDelete = async () => {
    if (!activeEvent.id) return
    await apiRequest('/api/tasks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activeEvent.taskId || activeEvent.id }),
    })
    toast(t('event.eventDeleted'))
    setActiveEvent(null)
    await refetchEvents()
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-foreground/15 h-full w-full z-[9999]"
      />
      <div className="fixed inset-0 grid place-items-center z-[10000]">
        <motion.div
          layoutId={`card-${activeEvent.uniqueId}`}
          ref={ref}
          className="w-full max-w-[500px] h-full md:h-fit md:max-h-[90%] bg-background/80 rounded-md"
        >
          <div className="backdrop-blur-sm w-full h-full flex flex-col overflow-hidden rounded-md">
            <div className="flex-1 overflow-y-auto flex flex-col items-start gap-4 py-4">
              <motion.p
                layoutId={`title-${activeEvent.uniqueId}`}
                className="font-bold text-foreground px-4"
              >
                {activeEvent.title}
              </motion.p>

              <Separator /><SessionActions sessionId={activeEvent?.executionSessionId} taskId={activeEvent?.taskId} onBeforeOpen={() => setActiveEvent(null)} />
              {taskId && <div className="px-4"><Button asChild variant="outline" size="sm"><TaskDetailsLink taskId={taskId} onClick={() => setActiveEvent(null)}>{locale === 'zh' ? '查看任务详情' : 'View task details'}</TaskDetailsLink></Button></div>}

              <div>
                {activeEvent.start && activeEvent.end && (
                  <div className="px-4 gap-4 flex items-center">
                    <Clock size={24} />

                    <div>
                      <p className="text-muted-foreground text-xs">
                        {formatDateRange(activeEvent.start, activeEvent.end)}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {activeEvent.description && (
                <div className="px-4 flex gap-4">
                  <Text size={24} className="flex-shrink-0" />

                  <p>{pureText(activeEvent.description)}</p>
                </div>
              )}

              {activeEvent.attendees.length > 0 && (
                <div className="flex gap-4 items-center px-4">
                  <Users size={24} />

                  <div className="flex">
                    <AnimatedTooltip
                      items={activeEvent.attendees.map((attendee, idx) => ({
                        id: idx,
                        name: attendee,
                        image: `https://api.dicebear.com/9.x/initials/svg?seed=${attendee}&chars=1`,
                      }))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="border-t px-4 py-3 flex justify-between shrink-0">
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                <Trash2 className="w-4 h-4 mr-1" />
                {t('event.deleteEvent')}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setActiveEvent(null)}>
                  {t('taskDialog.cancel')}
                </Button>
                <Button size="sm" onClick={() => setTaskDialogOpen(true)}>
                  <Pencil className="w-4 h-4 mr-1" />
                  {t('taskDialog.editTask')}
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Edit Task Dialog */}
      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        initialData={{
          id: activeEvent.id,
          title: activeEvent.title,
          task_type: activeEvent.taskType,
          deadline_at: activeEvent.deadline_at || '',
          duration: activeEvent.duration,
          expected_difficulty: activeEvent.expectedDifficulty,
          dependency: activeEvent.dependency,
          priority: activeEvent.priority,
          context: activeEvent.context ?? activeEvent.description,
        }}
        onSave={async (taskData) => {
          await apiRequest('/api/tasks', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(taskData),
          })
          toast(t('event.eventUpdated'))
          setActiveEvent(null)
          await refetchEvents()
        }}
        onDelete={handleDelete}
      />
    </AnimatePresence>
  )
}
