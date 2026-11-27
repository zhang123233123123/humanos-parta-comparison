/** Existing accounts and saved drafts keep their chosen zone; new setup detects it. */
export function setupTimezone(profile: { timezone?: string; research_context?: { onboarding_completed?: boolean; onboarding_submitted?: boolean } }, draft: { timezone?: string } | null, detected: string, editing = false): string {
  const established = editing || profile.research_context?.onboarding_completed || profile.research_context?.onboarding_submitted
  const zone = (established ? profile.timezone : draft?.timezone || detected) || detected
  new Intl.DateTimeFormat('en', { timeZone: zone }).format(0)
  return zone
}
