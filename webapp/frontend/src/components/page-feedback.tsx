/** Presentation only: callers own request state and localized messages. */
export function LoadingSkeleton({ label }: { label: string }) {
  return <div className="humanos-page-enter mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-8" role="status" aria-live="polite" aria-busy="true">
    <p className="text-sm text-muted-foreground">{label}</p>
    <div aria-hidden="true" className="space-y-6">
      <div className="humanos-skeleton h-4 w-28 rounded-full" />
      <div className="humanos-skeleton h-10 w-2/3 max-w-md rounded-xl" />
      <div className="grid gap-5 md:grid-cols-3">
        <div className="rounded-2xl border bg-card p-6 md:col-span-2"><div className="humanos-skeleton h-6 w-1/2 rounded-lg" /><div className="humanos-skeleton mt-6 h-48 rounded-xl" /></div>
        <div className="rounded-2xl border bg-card p-6"><div className="humanos-skeleton h-6 w-2/3 rounded-lg" /><div className="humanos-skeleton mt-6 h-24 rounded-xl" /></div>
      </div>
    </div>
  </div>
}

export function ProcessingNotice({ label }: { label: string }) {
  return <div role="status" aria-live="polite" aria-atomic="true" className="humanos-page-enter flex items-center gap-3 rounded-2xl border border-primary/20 bg-card px-5 py-4 text-sm text-foreground shadow-sm">
    <span aria-hidden="true" className="relative flex h-3 w-3 shrink-0"><span className="humanos-status-pulse absolute inset-0 rounded-full bg-primary/25" /><span className="relative m-auto h-2 w-2 rounded-full bg-primary" /></span>
    <span>{label}</span>
  </div>
}
