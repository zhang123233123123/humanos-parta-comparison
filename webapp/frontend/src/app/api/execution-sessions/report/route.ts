import { workspacePost } from '@/lib/server/workspace-execution-proxy'
export const POST = (request: Request) => workspacePost(request, '/api/execution-sessions/report')
