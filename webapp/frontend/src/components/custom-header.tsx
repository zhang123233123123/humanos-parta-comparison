'use client'
import { FC, RefObject, useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react'
import FullCalendar from '@fullcalendar/react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useDevice } from '@/hooks/use-device'
import { useTranslation } from '@/i18n/LanguageProvider'
import { useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { localDate } from '@/lib/interaction/core'

interface CustomHeaderProps {
  calendarRef: RefObject<FullCalendar>
  onOpenGuide?: () => void
  clock?: { now: string; timezone: string }
}

const CustomHeader: FC<CustomHeaderProps> = ({ calendarRef, onOpenGuide, clock }) => {
  const runtime = useWorkspaceRuntime()
  const { t, locale } = useTranslation()
  const timezone = clock?.timezone || runtime?.snapshot?.profile.timezone
  const todayKey = clock ? localDate(Date.parse(clock.now), clock.timezone) : runtime?.snapshot ? localDate(runtime.now, runtime.snapshot.profile.timezone) : ''
  const [viewTitle, setViewTitle] = useState('')
  const [activeView, setActiveView] = useState('timeGridDay')
  const { isMobile } = useDevice()

  useEffect(() => {
    const calendarApi = calendarRef.current?.getApi()
    const updateView = () => {
      if (!calendarApi) return
      setActiveView(calendarApi.view.type)
      setViewTitle(calendarApi.getDate().toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', year: 'numeric', timeZone: timezone }))
    }
    updateView()
    calendarApi?.on('datesSet', updateView)
    return () => { calendarApi?.off('datesSet', updateView) }
  }, [calendarRef, locale, timezone])

  const goNext = useCallback(() => calendarRef.current?.getApi().next(), [calendarRef])
  const goPrev = useCallback(() => calendarRef.current?.getApi().prev(), [calendarRef])
  function goToday() {
    const calendarApi = calendarRef.current?.getApi()
    if (todayKey) calendarApi?.gotoDate(todayKey)
    else calendarApi?.today()
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable=true], [role=dialog]') || document.querySelector('[data-runtime-dialog]')) return
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [goNext, goPrev])

  useEffect(() => {
    if (isMobile) {
      calendarRef.current?.getApi().changeView('timeGridDay')
      setActiveView('timeGridDay')
    }
  }, [calendarRef, isMobile])

  const views = [
    ['dayGridMonth', t('header.month')],
    ['timeGridWeek', t('header.week')],
    ['timeGridDay', t('header.day')],
  ] as const
  return <TooltipProvider><div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b bg-background px-3 py-2 sm:px-4" role="toolbar" aria-label={locale === 'zh' ? '日历控制' : 'Calendar controls'}>
    <div className="flex min-w-0 items-center gap-3">
      <Button type="button" variant="outline" size="sm" className="h-8 px-3" title={t('header.goToToday')} onClick={goToday}>{t('header.today')}</Button>
      <h2 className="truncate text-sm font-semibold" aria-live="polite">{viewTitle}</h2>
    </div>
    <div className="ml-auto flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('header.previous')} onClick={goPrev}><ChevronLeft className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t('header.previous')}</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('header.next')} onClick={goNext}><ChevronRight className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{t('header.next')}</TooltipContent></Tooltip>
      </div>
      <div className="flex items-center rounded-lg border bg-muted/40 p-0.5" role="group" aria-label={locale === 'zh' ? '日历视图' : 'Calendar view'}>{views.map(([view, label]) => <button type="button" key={view} aria-pressed={activeView === view} className={`rounded-md px-2.5 py-1.5 text-xs transition sm:px-3 ${activeView === view ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => { setActiveView(view); calendarRef.current?.getApi().changeView(view) }}>{label}</button>)}</div>
      {onOpenGuide && <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={locale === 'zh' ? '新手指引' : 'Workspace guide'} onClick={onOpenGuide}><CircleHelp className="h-4 w-4" /></Button></TooltipTrigger><TooltipContent>{locale === 'zh' ? '新手指引' : 'Workspace guide'}</TooltipContent></Tooltip>}
    </div>
  </div></TooltipProvider>
}

export default CustomHeader
