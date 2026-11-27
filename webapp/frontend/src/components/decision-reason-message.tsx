import { decisionReason } from '@/lib/presentation/decision-reasons'

export function DecisionReasonMessage({ code, detail, locale }: { code?: string; detail?: string; locale: string }) {
  const result = decisionReason(code, locale)
  return <div className="space-y-1 rounded-md border p-2 text-sm">
    <p>{result.message}</p>
    <p className="text-xs text-muted-foreground">{result.nextStep}</p>
    {(code || detail) && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">{locale === 'zh' ? '查看诊断信息' : 'View diagnostics'}</summary><code className="block whitespace-pre-wrap break-words">{code}{detail ? `\n${detail}` : ''}</code></details>}
  </div>
}
