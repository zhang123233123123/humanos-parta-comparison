export const DRAFT_CANCELLED_EVENT = 'humanos:draft-cancelled'

export function visibleDrafts<T extends { status: string }>(drafts: T[]): T[] {
  return drafts.filter(draft => draft.status !== 'cancelled')
}

export function clearCancelledTarget<T extends { draft_id: string }>(target: T | null, draftId: string): T | null {
  return target?.draft_id === draftId ? null : target
}
