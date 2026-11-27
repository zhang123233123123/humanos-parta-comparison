import { schedulingFailure } from '@/lib/presentation/scheduling-failures'
/** Transport-independent error presentation. Never retries or changes data. */
export function apiFailure(status: number, payload: unknown, locale: string) {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const code = typeof body.code === 'string' ? body.code : typeof body.error === 'string' ? body.error : ''
  const diagnostic = typeof body.message === 'string' ? body.message : code
  const zh = locale === 'zh'
  let message: string
  if (code === 'invalid_response') message = zh ? '服务器返回的数据无法读取。请刷新核对当前记录；暂时无法确认本次操作结果。' : 'The server response could not be read. Refresh and check the records; this operation’s outcome is unconfirmed.'
  else if (status === 401) message = zh ? '登录状态已失效，请重新登录后再操作。' : 'Your sign-in has expired. Sign in again before continuing.'
  else if (status === 403) message = zh ? '当前账号没有执行此操作的权限。请确认登录账号，或联系管理员。' : 'This account is not allowed to perform this action. Check the account or contact an administrator.'
  else if (status === 404) message = zh ? '找不到要操作的记录或服务，可能已被移除。请刷新列表后核对。' : 'The requested record or service was not found and may have been removed. Refresh the list and check.'
  else if (status === 409) message = zh ? '当前记录已变化，或此操作与现有状态冲突。请刷新核对后再操作，避免覆盖已有修改。' : 'The record changed or this action conflicts with its current state. Refresh and review before continuing to avoid overwriting changes.'
  else if (status === 429) message = zh ? '请求过于频繁或服务额度暂时受限。请稍后再试，不要连续点击。' : 'Requests are rate-limited or service quota is temporarily restricted. Wait before trying again.'
  else if (status === 400 || status === 422) {
    const score = diagnostic.match(/^(focus|energy|stress) must be a whole number from 1 to 7$/)
    if (score) message = zh ? `${({focus:'专注',energy:'精力',stress:'压力'} as Record<string,string>)[score[1]]}需要填写 1–7 的整数，也可以留空。` : `${score[1]} must be a whole number from 1 to 7, or left unreported.`
    else if (diagnostic === 'energy_demand must be unknown, low, medium or high') message = zh ? '精力需求请选择“未知、低、中、高”之一。' : 'Select Unknown, Low, Medium or High for energy demand.'
    else message = zh ? '提交的信息未通过检查。请核对必填项、时间范围和当前记录状态后再提交。' : 'The submitted information did not pass validation. Review required fields, time ranges and record state before submitting again.'
  }
  else if (status === 0 || status === 408 || status === 504) message = zh ? '连接中断或等待超时，暂时无法确认操作结果。请检查网络并刷新核对记录，避免重复提交。' : 'The connection was interrupted or timed out. The outcome is unconfirmed. Check your connection and refresh the records before submitting again.'
  else if (status >= 500) message = zh ? '服务暂时未能完成请求。请稍后刷新核对结果；若已经提交保存，请先确认是否生效，避免重复操作。' : 'The service could not complete the request. Refresh later to check the result; verify any submitted changes before repeating the action.'
  else message = zh ? '本次操作未能确认完成。请刷新核对当前记录；若仍出现，请保留诊断信息并反馈。' : 'Completion could not be confirmed. Refresh and check the records; if this persists, retain the diagnostics for support.'
  if (status === 400 || status === 422) message = schedulingFailure(code, body.violations, zh) || message
  return { message, code, diagnostic, status }
}
