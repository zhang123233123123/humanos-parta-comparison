'use client'
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/lib/client/api'
import { requestId } from '@/lib/client/request-id'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Draft = { draft_id: string; thread_id: string; version: number; status: string; task: { title: string; missing_fields?: string[] } }
type Turn = { user_text: string; assistant_reply: string }
type Job = { job_id: string; status: string; error?: string; result?: { reply: string } }
export function TaskDraftSupplement({ draftId, locale, onClose }: { draftId: string; locale: string; onClose: () => void }) {
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const alive = useRef(true)
  const attempt = useRef<{ id: string; text: string; version: number; job?: Job } | null>(null)
  async function reload() {
    setLoading(true)
    try {
      const result = await apiRequest<{ drafts: Draft[] }>('/api/task-drafts', { cache: 'no-store' })
      const current = result.drafts.find(d => d.draft_id === draftId)
      if (!current) throw new Error(zh ? '草稿已不存在。' : 'Draft no longer exists.')
      if (alive.current) { setDraft(current); setError('') }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Unable to load draft') }
    finally { if (alive.current) setLoading(false) }
  }
  useEffect(() => { alive.current = true; void reload(); return () => { alive.current = false } }, [draftId]) // eslint-disable-line react-hooks/exhaustive-deps
  async function send() {
    if (!draft || !text.trim() || lock.current) return
    lock.current = true; setBusy(true); setError('')
    const current = attempt.current ?? { id: requestId('draft-supplement'), text: text.trim(), version: draft.version }
    attempt.current = current
    try {
      if (!current.job) current.job = (await apiRequest<{ job: Job }>('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: current.text, assistant_mode: 'draft_supplement',
          thread_id: draft.thread_id, draft_id: draft.draft_id, draft_version: current.version,
          locale, request_id: current.id, supplement_context: turns.slice(-2) }),
      })).job
      if (!current.job?.job_id) throw new Error('Missing supplement job ID')
      for (let i = 0; i < 180 && !['completed', 'failed'].includes(current.job.status); i++) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (!alive.current) return
        current.job = (await apiRequest<{ job: Job }>(`/api/background-jobs?job_id=${encodeURIComponent(current.job.job_id)}`)).job
      }
      if (current.job.status === 'failed') {
        attempt.current = null
        throw new Error(current.job.error || (zh ? '补充失败，请重新加载草稿后重试。' : 'Supplement failed. Reload the draft and retry.'))
      }
      if (current.job.status !== 'completed') throw new Error(zh ? '仍在处理中，请点击重试查看结果。' : 'Still processing. Retry to check the result.')
      setTurns(previous => [...previous, { user_text: current.text, assistant_reply: current.job!.result?.reply || '' }])
      setText(''); attempt.current = null
      await reload()
      window.dispatchEvent(new Event('humanos:drafts-updated'))
    } catch (e) { setError(e instanceof Error ? e.message : 'Supplement failed') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const editable = draft && ['ready', 'needs_input'].includes(draft.status)
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent><DialogHeader><DialogTitle>{zh ? '补充／修改任务草稿' : 'Supplement task draft'}</DialogTitle>
      <DialogDescription>{draft?.task.title || (zh ? '正在加载草稿…' : 'Loading draft…')}</DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">{zh ? '这里的输入只用于这份草稿。修改后仍需在草稿卡片确认保存。' : 'Updates apply only to this draft. Confirm the task on its card after editing.'}</p>
      {loading && <p role="status">{zh ? '正在加载…' : 'Loading…'}</p>}
      {!loading && draft && <p className="text-sm">{editable ? (draft.task.missing_fields?.length ? (zh ? '待补充：' : 'Missing: ') + draft.task.missing_fields.map(f => ({ duration_minutes: zh ? '预计时长' : 'Duration', deadline_at: zh ? '截止时间' : 'Deadline', start_at: zh ? '开始时间' : 'Start time', clarification: zh ? '待澄清信息' : 'Clarification' }[f] || f)).join('、') : (zh ? '信息已齐全，也可以继续修改。' : 'Details complete. You may still edit.')) : (zh ? '该草稿当前不可补充，请关闭后查看最新状态。' : 'This draft is no longer editable.')}</p>}
      <div className="max-h-64 space-y-3 overflow-y-auto" aria-live="polite">{turns.map((turn, i) => <div key={i} className="space-y-1 text-sm"><p>{turn.user_text}</p><p className="rounded bg-muted p-2">{turn.assistant_reply}</p></div>)}</div>
      {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p><Button variant="outline" disabled={busy} onClick={() => void reload()}>{zh ? '重新加载草稿' : 'Reload draft'}</Button></div>}
      <textarea aria-label={zh ? '草稿补充内容' : 'Draft supplement'} rows={3} className="w-full rounded border bg-background p-3" value={text} disabled={busy || loading || !editable || !!attempt.current} onChange={e => setText(e.target.value)} placeholder={zh ? '例如：预计三小时，周五前完成' : 'For example: three hours, due Friday'} />
      <Button disabled={busy || loading || !editable || !text.trim()} onClick={() => void send()}>{busy ? (zh ? '正在处理…' : 'Processing…') : attempt.current ? (zh ? '重试／查看结果' : 'Retry / check result') : (zh ? '提交补充' : 'Submit supplement')}</Button>
    </DialogContent>
  </Dialog>
}
