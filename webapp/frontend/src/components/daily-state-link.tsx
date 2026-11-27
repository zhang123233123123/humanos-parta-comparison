'use client'
import { CheckCircle2, Activity } from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageProvider'
import { useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
import { dailyRecorded } from '@/lib/interaction/core'
export function DailyStateLink() {
  const runtime = useWorkspaceRuntime(); const { locale } = useTranslation(); const zh = locale === 'zh'
  const done = runtime?.snapshot ? dailyRecorded(runtime.snapshot.gate) : false
  const Icon = done ? CheckCircle2 : Activity
  const label = done ? (zh ? '今日已填写' : 'Today recorded') : (zh ? '今日状态' : 'Daily state')
  return <button type="button" id="guide-nav-check-in" disabled={!runtime || runtime.blocked} title={runtime?.readError ? (zh ? '状态读取失败；可重试或主动填写' : 'Unable to read status; retry or report') : label} onClick={() => runtime?.open({kind:'state', id:'manual-state', source:'manual'})} className={`flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs ${done ? 'border-transparent font-medium text-muted-foreground hover:bg-muted' : 'border-transparent text-muted-foreground hover:bg-muted'}`}><Icon aria-hidden="true" className="h-4 w-4"/><span>{label}</span></button>
}
