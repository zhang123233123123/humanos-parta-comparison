'use client'

import { useRef } from 'react'
import { toast } from 'sonner'
import { TaskDialog } from '@/components/task-dialog'
import { useTranslation } from '@/i18n/LanguageProvider'
import { requestId as makeRequestId } from '@/lib/client/request-id'
import { apiRequest } from '@/lib/client/api'

/** Relocated structured task creation. The request contract is unchanged. */
export function WorkspaceAddTask({ onClose }: { onClose: () => void }) {
  const { locale } = useTranslation()
  const zh = locale === 'zh'
  const requestId = useRef<string | null>(null)
  return <TaskDialog open presentation="inline" onOpenChange={open => { if (!open) onClose() }} onSave={async task => {
    requestId.current ??= makeRequestId('structured-task')
    const result = await apiRequest<{data:{task:{id:string}}}>('/api/tasks', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...task, request_id:requestId.current}),
    })
    if (!result.data?.task?.id) throw new Error(zh ? '未收到任务保存确认，请重试。' : 'Task save was not acknowledged; retry.')
    requestId.current = null
    window.dispatchEvent(new Event('humanos:tasks-updated'))
    toast.success(zh ? '任务已添加到待安排。' : 'Task added to the pending list.')
  }} />
}
