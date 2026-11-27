'use client'
import { TodayState } from '@/components/workspace-runtime/today-state'

export function WorkspaceSidebar() {
  return <aside className="flex h-full w-[208px] shrink-0 flex-col border-r bg-muted/40">
    <div className="min-h-0 flex-1 overflow-y-auto"><TodayState /></div>
  </aside>
}
