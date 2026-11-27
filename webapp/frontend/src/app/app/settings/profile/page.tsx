'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BehaviorPatternsPanel } from '@/components/behavior-patterns-panel'
import { DailyActivitiesPanel } from '@/components/daily-activities-panel'
import { apiRequest } from '@/lib/client/api'
import { useTranslation } from '@/i18n/LanguageProvider'

export default function ProfilePage() {
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  async function exportData() {
    setExporting(true); setExportError('')
    try {
      const result = await apiRequest<{ data: unknown }>('/api/profile-data/export', { cache: 'no-store' })
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url
      anchor.download = `humanos-behavior-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url)
    } catch (error) { setExportError(error instanceof Error ? error.message : (zh ? '导出失败，请重试。' : 'Export failed; retry.')) }
    finally { setExporting(false) }
  }
  return <main className="h-full overflow-y-auto bg-muted/20"><div className="mx-auto max-w-5xl space-y-6 p-5 md:p-8">
    <Link href="/app/settings" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />{zh ? '返回设置' : 'Back to settings'}</Link>
    <header><h1 className="text-3xl font-semibold">{zh ? '行为归纳管理' : 'Behavior pattern settings'}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{zh ? '这些行为由系统自动归纳，并非你确认的偏好。停用或删除只影响后续建议，原始行为记录保留。' : 'These patterns are inferred automatically, not user-confirmed preferences. Pausing or deleting affects future suggestions and preserves original records.'}</p>
      <DailyActivitiesPanel locale={locale} />
      <Button className="mt-4" variant="outline" disabled={exporting} onClick={() => void exportData()}>{exporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{zh ? '导出行为数据' : 'Export behavior data'}</Button>
      {exportError && <p role="alert" className="mt-2 text-sm text-destructive">{exportError}</p>}
    </header><BehaviorPatternsPanel manage />
  </div></main>
}
