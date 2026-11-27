import { apiRequest } from '@/lib/client/api'

export function hasRunningDraftSchedules(drafts: Array<{ scheduling?: { status: string } }>): boolean {
  return drafts.some(draft => ['queued', 'running'].includes(draft.scheduling?.status || ''))
}

export class DraftSchedulingError extends Error {
  constructor(public readonly terminal: boolean, message: string) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// This operation can only request scheduling. It never submits/creates tasks.
// Keep requestId across transport failures; use a new one after a terminal job failure.
export async function scheduleSavedDraft(
  draftId: string,
  requestId: string,
  request: typeof apiRequest = apiRequest,
  wait: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 1000)),
  retryJobId?: string,
) {
  const accepted = await request<{ job: { job_id: string } }>('/api/schedules/decide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'draft_submitted', draft_id: draftId, request_id: requestId, retry_job_id: retryJobId }),
  })
  if (!accepted.job?.job_id) throw new DraftSchedulingError(false, 'Missing schedule job ID')
  for (let attempt = 0; attempt < 180; attempt++) {
    const { job } = await request<{ job: { status: string; error?: string } }>(`/api/background-jobs?job_id=${encodeURIComponent(accepted.job.job_id)}`)
    if (job.status === 'failed') throw new DraftSchedulingError(true, job.error || 'Scheduling failed')
    if (job.status === 'completed') return 'completed' as const
    await wait()
  }
  return 'pending' as const
}
