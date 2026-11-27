'use client'

import { type ReactNode } from 'react'

export function openTaskDetails(taskId: string) {
  window.dispatchEvent(new CustomEvent('humanos:task-details', { detail: { taskId } }))
}
export function TaskDetailsLink({ taskId, children, className, onClick }: { taskId: string; children: ReactNode; className?: string; onClick?: () => void }) {
  return <button type="button" className={className || 'text-left text-xs text-primary underline underline-offset-4'} onClick={() => { onClick?.(); openTaskDetails(taskId) }}>{children}</button>
}
