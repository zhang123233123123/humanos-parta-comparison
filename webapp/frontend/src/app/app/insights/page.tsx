'use client'
import { BrainCircuit } from 'lucide-react'
import Link from 'next/link'
import { BehaviorPatternsPanel } from '@/components/behavior-patterns-panel'
import { useTranslation } from '@/i18n/LanguageProvider'

export default function InsightsPage() {
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  return <main className="h-full overflow-y-auto bg-muted/20"><div className="mx-auto max-w-5xl space-y-6 p-5 md:p-8">
    <header><p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">HumanOS / Insights</p>
      <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold"><BrainCircuit className="h-7 w-7" />{zh ? '长期行为' : 'Long-term behavior'}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{zh ? '系统从多次相似行为中自动归纳，作为后续建议的参考。归纳可能不准确，你可以在设置中停用或删除。' : 'Repeated similar behavior is summarized automatically for future suggestions. You can pause or delete these inferences in settings.'}</p>
      <Link href="/app/settings/profile" className="mt-3 inline-block text-sm text-primary underline">{zh ? '管理行为归纳' : 'Manage behavior patterns'}</Link>
    </header><BehaviorPatternsPanel />
  </div></main>
}
