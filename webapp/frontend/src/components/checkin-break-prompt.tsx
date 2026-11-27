'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/client/api'
import { breakCommand, claimBreakSuggestion, type BreakSuggestion } from '@/lib/client/break-suggestion'
import type { ExecutionResourceEnvelope, ExecutionSession } from '@/lib/contracts/execution-contracts'

export function CheckinBreakPrompt({ suggestion, locale }: { suggestion: BreakSuggestion; locale: string }) {
  const router = useRouter()
  const zh = locale === 'zh'
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const command = useRef<ReturnType<typeof breakCommand> | null>(null)

  useEffect(() => {
    let storage: Storage | undefined
    try { storage = window.localStorage } catch { /* Private browsing may deny access. */ }
    if (claimBreakSuggestion(suggestion.id, storage)) setOpen(true)
  }, [suggestion.id])

  const accept = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    // Retry the exact same command after an ambiguous network failure.
    command.current ??= breakCommand(suggestion, minutes, Date.now())
    try {
      const result = await apiRequest<ExecutionResourceEnvelope<{ execution_session: ExecutionSession }>>('/api/execution-sessions/interrupt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.current),
      })
      window.dispatchEvent(new CustomEvent('humanos:execution-updated', {
        detail: { action: 'break', breakMinutes: minutes, executionSession: result.data.execution_session },
      }))
      setOpen(false)
      router.push('/app')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : (zh ? '暂时无法确认休息是否成功，请重试或到专注页查看。' : 'Unable to confirm the break. Retry or check Focus.'))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <Dialog open={open} onOpenChange={value => { if (!pending.current) setOpen(value) }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{zh ? '要休息一会儿吗？' : 'Would you like a short break?'}</DialogTitle>
        <DialogDescription>{zh ? '你刚刚报告专注或精力较低，或压力较高。这只是一次建议；是否休息由你决定。' : 'You just reported lower focus or energy, or higher stress. This is only a suggestion; the choice is yours.'}</DialogDescription>
      </DialogHeader>
      {suggestion.task_title && <p className="text-sm font-medium">{suggestion.task_title}</p>}
      <p className="text-sm text-muted-foreground">{zh ? '任务仍在计时。确认后才暂停并保存剩余工作，不会自动修改日历；恢复前会检查后续时间冲突。' : 'Your task is still running. Confirming pauses it and preserves remaining work, without changing the calendar. Schedule conflicts are checked before resuming.'}</p>
      <div className="flex gap-2" role="group" aria-label={zh ? '休息时长' : 'Break duration'}>
        {[5, 10, 15].map(value => <Button key={value} variant={value === minutes ? 'default' : 'outline'} aria-pressed={value === minutes} disabled={busy || command.current !== null} onClick={() => setMinutes(value)}>{value} {zh ? '分钟' : 'min'}</Button>)}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{error ? (zh ? '关闭' : 'Close') : (zh ? '继续任务，不休息' : 'Keep working')}</Button>
        <Button disabled={busy} onClick={() => void accept()}>{busy ? (zh ? '正在确认…' : 'Confirming…') : error ? (zh ? '重试确认' : 'Retry confirmation') : (zh ? `确认休息 ${minutes} 分钟` : `Confirm ${minutes}-minute break`)}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
