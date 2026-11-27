import { apiRequest } from './api'
import type { ExecutionImpact, ExecutionResourceEnvelope } from '../contracts/execution-contracts'

export async function checkExecutionImpact(executionSessionId: string): Promise<ExecutionImpact> {
  const result = await apiRequest<ExecutionResourceEnvelope<{ impact: ExecutionImpact }>>('/api/execution-sessions/impact', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ execution_session_id: executionSessionId, action: 'resume' }),
  })
  return result.data.impact
}
