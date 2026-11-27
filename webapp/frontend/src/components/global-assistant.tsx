'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MessageCircleQuestion, X } from 'lucide-react'
import { usePlanPreview } from '@/hooks/use-plan-preview'
import { useRef } from 'react'
import { useInteractionBlock, useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import Image from 'next/image'
import { Chat } from '@/components/chat'
import { Button } from '@/components/ui/button'
import { useChat } from '@/hooks/use-chat'
import { useTranslation } from '@/i18n/LanguageProvider'

export function GlobalAssistant() {
  const { chatOpen, setChatOpen } = useChat()
  const { locale, setLocale } = useTranslation()
  const open = Boolean(chatOpen)
  const runtime = useWorkspaceRuntime()
  const dragging = useRef(false)
  const reducedMotion = useReducedMotion()
  const plan = usePlanPreview(s => s.plan)
  const visible = open && !runtime?.overlay && !plan && Boolean(runtime?.snapshot?.profile.onboarding_completed)
  useInteractionBlock('calendar-advisor', visible)
  const label = locale === 'zh' ? '日程顾问' : 'Calendar Advisor'
  const actionLabel = open
    ? (locale === 'zh' ? '关闭日程顾问' : 'Close Calendar Advisor')
    : (locale === 'zh' ? '打开日程顾问' : 'Open Calendar Advisor')

  if (!visible) return null
  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/25 p-3 backdrop-blur-[2px] sm:p-6"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) setChatOpen('')
            }}
          >
            <motion.section
              id="global-calendar-advisor"
              role="dialog"
              aria-label={label}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="flex h-[min(680px,calc(100dvh-1.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:h-[min(680px,calc(100dvh-3rem))]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                <span className="flex items-center gap-2"><MessageCircleQuestion className="h-4 w-4" />{locale === 'zh' ? '日程顾问' : 'Calendar advisor'}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <div role="group" aria-label={locale === 'zh' ? '界面语言' : 'Interface language'} className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
                    {(['zh', 'en'] as const).map(language => <button key={language} type="button" lang={language} aria-pressed={locale === language} onClick={() => setLocale(language)} className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${locale === language ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{language === 'zh' ? '中文' : 'EN'}</button>)}
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setChatOpen('')} aria-label={actionLabel}><X className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="min-h-0 flex-1"><Chat chatOpen={chatOpen} closeChat={() => setChatOpen('')} /></div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
