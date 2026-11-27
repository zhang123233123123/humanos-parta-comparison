export type BehaviorPatternStatus = 'active' | 'paused' | 'deleted'
export type BehaviorPattern = {
  id: string
  description: string
  scope: string
  confidence: 'low' | 'medium' | 'high'
  status: BehaviorPatternStatus
  learning_status: 'collecting' | 'pending' | 'processing' | 'ready' | 'failed'
  support_count: number
  authority: 'system_inferred_behavior'
  updated_at: number
  sources: Array<{
    experience_id: string
    source_type: string
    source_id: string
    session_id: string | null
    summary: string
    created_at: number
  }>
}
export type BehaviorPatternsData = {
  patterns: BehaviorPattern[]
  processing_count: number
  failed_count: number
}
