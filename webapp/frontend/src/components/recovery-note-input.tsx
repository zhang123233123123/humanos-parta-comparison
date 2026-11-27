'use client'

export function RecoveryNoteInput({ value, onChange, locale }: {
  value: string
  onChange: (value: string) => void
  locale: string
}) {
  const zh = locale === 'zh'
  return <label className="grid gap-2 text-sm">
    <span>{zh ? '给回来后的自己留张便签（可选）' : 'Leave yourself a note (optional)'}</span>
    <textarea value={value} onChange={event => onChange(event.target.value)}
      placeholder={zh ? '可以写做到哪里、回来想做什么，或为什么停下。只写你需要的内容，也可以留空。' : 'Where did you stop? What would you like to do next? Add only what helps you, or leave this empty.'}
      className="min-h-24 w-full rounded-xl border bg-background p-3" />
    <span className="text-xs text-muted-foreground">{zh ? '暂停仍会保存计时和剩余工作；便签不影响能否暂停。' : 'Pausing saves elapsed time and remaining work even without a note.'}</span>
  </label>
}

export function RecoveryDetailsInput({ locale, nextAction, onNextActionChange, openQuestions, onOpenQuestionsChange, reason, onReasonChange }: {
  locale: string
  nextAction: string
  onNextActionChange: (value: string) => void
  openQuestions?: string
  onOpenQuestionsChange?: (value: string) => void
  reason?: string
  onReasonChange?: (value: string) => void
}) {
  const zh = locale === 'zh'
  return <details className="rounded-xl border p-3 text-sm">
    <summary className="cursor-pointer">{zh ? '补充恢复线索（可选）' : 'Add recovery details (optional)'}</summary>
    <div className="mt-3 grid gap-3">
      <label className="grid gap-1.5"><span>{zh ? '回来后的下一步' : 'Next action on return'}</span><input className="rounded-md border bg-background p-2" value={nextAction} onChange={event => onNextActionChange(event.target.value)} placeholder={zh ? '例如：补上第二段的引用' : 'For example: add citations to paragraph two'} /></label>
      {onOpenQuestionsChange && <label className="grid gap-1.5"><span>{zh ? '未解决问题' : 'Open questions'}</span><textarea className="rounded-md border bg-background p-2" value={openQuestions || ''} onChange={event => onOpenQuestionsChange(event.target.value)} /></label>}
      {onReasonChange && <label className="grid gap-1.5"><span>{zh ? '暂停原因' : 'Pause reason'}</span><select className="rounded-md border bg-background p-2" value={reason || ''} onChange={event => onReasonChange(event.target.value)}><option value="">{zh ? '不记录原因' : 'Not reported'}</option><option value="interrupted">{zh ? '被打断' : 'Interrupted'}</option><option value="fatigue">{zh ? '疲劳' : 'Tired'}</option><option value="blocked">{zh ? '卡住了' : 'Blocked'}</option><option value="context_switch">{zh ? '切换情境' : 'Context switch'}</option><option value="external_event">{zh ? '外部事情' : 'External event'}</option></select></label>}
    </div>
  </details>
}
