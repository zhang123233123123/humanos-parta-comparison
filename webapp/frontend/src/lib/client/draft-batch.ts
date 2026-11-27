import { apiRequest } from '@/lib/client/api'
import { scheduleSavedDraft } from './draft-scheduling'

export type BatchDraft = { draft_id: string; version: number; status: string; task: { missing_fields?: string[] } }
export function readyBatch(drafts: BatchDraft[]) {
  return drafts.filter(d => d.status === 'ready' && !d.task.missing_fields?.length)
    .map(d => ({ draft_id: d.draft_id, version: d.version }))
}

// Retain the snapshot on failure: backend submission replays saved drafts,
// including a successful write whose HTTP response was lost.
export async function submitDraftBatch(
  drafts: Array<{ draft_id: string; version: number }>, id: string,
  request: typeof apiRequest = apiRequest, schedule: typeof scheduleSavedDraft = scheduleSavedDraft,
) {
  if (!drafts.length) throw new Error('No complete drafts selected')
  for (const draft of drafts) {
    await request(`/api/task-drafts/${encodeURIComponent(draft.draft_id)}/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: draft.version }),
    })
  }
  // The existing draft job proposes a week for current saved tasks.
  // No per-task scheduling calls and no automatic calendar confirmation.
  const anchor = drafts[drafts.length - 1].draft_id
  const latest = await request<{ drafts: Array<{ draft_id: string; scheduling?: { job_id?: string } }> }>('/api/task-drafts')
  const jobId = latest.drafts.find(d => d.draft_id === anchor)?.scheduling?.job_id
  return schedule(anchor, id, request, undefined, jobId)
}
