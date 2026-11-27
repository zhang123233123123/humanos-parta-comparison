import Link from 'next/link'
import type { ReactNode } from 'react'

export function WorkspaceNavigationFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <header
      className={`z-50 flex shrink-0 items-center border-b bg-background px-2 sm:px-4 ${className || 'h-14'}`}
    >
      <Link
        href="/app"
        className="mr-2 shrink-0 font-semibold tracking-[-0.03em] text-foreground sm:mr-6"
      >
        HumanOS
      </Link>
      {children}
    </header>
  )
}
