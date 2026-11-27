'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/client/api'
import type { BehaviorPattern, BehaviorPatternsData, BehaviorPatternStatus } from '@/lib/contracts/behavior-contracts'
import { useTranslation } from '@/i18n/LanguageProvider'

export function BehaviorPatternsPanel({ manage = false }: { manage?: boolean }) {
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  const [data, setData] = useState<BehaviorPatternsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState('')
  const version = useRef(0)
  const load = useCallback(async () => {
    const ticket = ++version.current
    setLoading(true)
    setError('')
    try {
      const result = await apiRequest<{ data: BehaviorPatternsData }>('/api/behavior-patterns', { cache: 'no-store' })
      if (!Array.isArray(result.data?.patterns)) throw new Error(zh ? '行为数据格式无效' : 'Invalid behavior response')
      if (ticket === version.current) setData(result.data)
    } catch (failure) {
      if (ticket === version.current) setError(failure instanceof Error ? failure.message : (zh ? '暂时无法读取，请重试。' : 'Unable to load; retry.'))
    } finally { if (ticket === version.current) setLoading(false) }
  }, [zh])
  useEffect(() => { void load(); return () => { version.current++ } }, [load])
  useEffect(() => {
    if (!data?.processing_count || busy || loading || error) return
    const timer = window.setTimeout(() => { void load() }, 10000)
    return () => window.clearTimeout(timer)
  }, [data, busy, loading, error, load])

  async function change(pattern: BehaviorPattern, status: BehaviorPatternStatus) {
    if (busy) return
    if (status === 'deleted' && !window.confirm(zh ? '删除这条归纳？以后不会再使用它，原始行为记录保留。' : 'Delete this pattern? It will no longer be used. Original behavior records remain.')) return
    ++version.current // Earlier reads must not undo the persisted status.
    setBusy(pattern.id)
    setSaved(false)
    setError('')
    try {
      const result = await apiRequest<{ data: { pattern: BehaviorPattern } }>(`/api/behavior-patterns/${encodeURIComponent(pattern.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (result.data?.pattern.id !== pattern.id || result.data.pattern.status !== status) throw new Error(zh ? '未收到保存结果，请重新读取。' : 'Persistence was not confirmed. Reload to check.')
      setSaved(true)
      setData(current => current && ({ ...current, patterns: current.patterns.flatMap(item => item.id !== pattern.id ? [item] : status === 'deleted' ? [] : [result.data.pattern]) }))
      await load()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : (zh ? '操作失败，请重新读取。' : 'Action failed; reload to check.'))
    } finally { setBusy('') }
  }

  if (loading && !data) return <div role="status" className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{zh ? '正在读取行为归纳…' : 'Loading behavior patterns…'}</div>
  const visible = data?.patterns.filter(p => manage || p.status === 'active') || []
  return <section className="space-y-4">
    {saved && <p role="status" className="text-sm text-muted-foreground">{zh ? '修改已保存。' : 'Change saved.'}{error ? (zh ? '列表暂时无法刷新，请重新加载。' : 'The list could not refresh. Reload it.') : ''}</p>}
    {error && <div role="alert" className="rounded-xl border p-4"><p className="text-sm">{error}</p><Button className="mt-3" variant="outline" disabled={loading || Boolean(busy)} onClick={() => void load()}>{zh ? '重新加载' : 'Reload'}</Button></div>}
    {Boolean(data?.processing_count) && <p role="status" className="text-sm text-muted-foreground">{zh ? '后台正在总结新行为，完成后会自动更新。' : 'New behavior is being summarized. Results update automatically.'}</p>}
    {Boolean(data?.failed_count) && <div className="rounded-xl border p-4 text-sm"><p>{zh ? '部分行为总结暂未完成，后台会重试；原始记录已保留。' : 'Some summaries failed. Background processing will retry; original records remain.'}</p><Button className="mt-2" variant="outline" disabled={loading || Boolean(busy)} onClick={() => void load()}>{zh ? '刷新处理状态' : 'Refresh status'}</Button></div>}
    {!loading && !error && visible.length === 0 && <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{zh ? '目前没有可展示的长期行为。至少 3 次独立的相似行为，才能形成自动归纳。' : 'No long-term patterns yet. At least three independent similar occurrences are needed.'}</p>}
    {visible.map(pattern => <article key={pattern.id} className="rounded-xl border bg-card p-5">
      <h2 className="text-base font-semibold">{pattern.description}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{zh ? '适用情境：' : 'Applies to: '}{pattern.scope}</p>
      <p className="mt-2 text-xs text-muted-foreground">{zh ? '系统归纳' : 'System inferred'} · {pattern.support_count} {zh ? '次独立行为' : 'independent occurrences'} · {pattern.status === 'paused' ? (zh ? '已停用' : 'Paused') : pattern.learning_status !== 'ready' ? (zh ? '正在更新，暂不使用' : 'Updating; not currently used') : (zh ? '可供后续建议参考' : 'Available for future suggestions')}</p>
      <details className="mt-3 text-sm"><summary className="cursor-pointer">{zh ? '查看支持记录' : 'View supporting records'}</summary><ul className="mt-2 space-y-2">{pattern.sources.map(source => <li key={source.experience_id} className="rounded-lg bg-muted p-3">{source.summary}</li>)}</ul></details>
      {manage && <div className="mt-4 flex gap-2"><Button size="sm" variant="outline" disabled={Boolean(busy) || loading} onClick={() => void change(pattern, pattern.status === 'active' ? 'paused' : 'active')}>{busy === pattern.id ? <Loader2 className="h-4 w-4 animate-spin" /> : pattern.status === 'active' ? (zh ? '停用' : 'Pause') : (zh ? '启用' : 'Enable')}</Button><Button size="sm" variant="ghost" className="text-destructive" disabled={Boolean(busy) || loading} onClick={() => void change(pattern, 'deleted')}>{zh ? '删除' : 'Delete'}</Button></div>}
    </article>)}
  </section>
}
