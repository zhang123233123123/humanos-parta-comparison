import { apiFailure } from '@/lib/presentation/api-failures'
import { errorLocale } from '@/lib/client/error-locale'

export class ApiResponseError extends Error {
  status: number
  diagnostic: string
  code: string

  constructor(status: number, message: string, code = '', locale = errorLocale()) {
    const failure = apiFailure(status, { message, code }, locale)
    super(failure.message)
    this.name = 'ApiResponseError'
    this.status = status
    this.diagnostic = message
    this.code = code
  }
}

export function apiResponseError(status: number, payload: unknown, locale = errorLocale()): ApiResponseError {
  const failure = apiFailure(status, payload, locale)
  const error = new ApiResponseError(status, failure.diagnostic, failure.code, locale)
  error.message = failure.message
  return error
}

export async function apiRequest<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  let response: Response
  try { response = await fetch(input, init) }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiResponseError(0, error instanceof Error ? error.message : 'Network request failed', 'network_unavailable')
  }
  if (response.status === 204 && response.ok) return undefined as T
  let payload: unknown
  try { payload = await response.json() }
  catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiResponseError(response.status, 'Response was not valid JSON', response.ok ? 'invalid_response' : 'unreadable_error_response')
  }
  if (!response.ok) {
    throw apiResponseError(response.status, payload)
  }
  return payload as T
}
