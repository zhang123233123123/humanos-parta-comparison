import { DEMO_MODE } from '../demo/config'
import { createDemoInteractionService } from '../demo/interaction-service'
import { createLiveService } from './live-service'

// Select once from the explicit frontend launch flag, never from a failed request.
export function createWorkspaceService(accountId: string, locale: string) {
  return DEMO_MODE ? createDemoInteractionService(accountId, locale) : createLiveService(accountId, locale)
}
