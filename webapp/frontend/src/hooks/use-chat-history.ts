'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '@/lib/client/api'
import { requestId } from '@/lib/client/request-id'
import type { ChatThread, ChatTurn, HistoryPage } from '@/lib/contracts/chat-contracts'

const json = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
export function useChatHistory(onSend: (text: string, thread: string, request: string) => Promise<unknown>, locale: string, requestScope = '') {
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const generation = useRef(0)
  const busy = useRef(false)
  const retry = useRef<{ text: string; thread: string; id: string; scope: string } | null>(null)
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Conversation request failed')
  const list = useCallback(() => apiRequest<{ threads: ChatThread[]; active_thread_id: string | null }>('/api/chat/threads'), [])
  const history = useCallback((id: string, before?: string) => apiRequest<HistoryPage>(`/api/chat/turns?thread_id=${encodeURIComponent(id)}${before ? `&before=${encodeURIComponent(before)}` : ''}`), [])
  const reload = useCallback(async () => {
    const token = ++generation.current
    setLoading(true); setError('')
    try {
      const result = await list()
      const page = result.active_thread_id ? await history(result.active_thread_id) : { turns: [], next_cursor: null }
      if (token !== generation.current) return
      setThreads(result.threads); setActive(result.active_thread_id); setTurns(page.turns); setCursor(page.next_cursor)
    } catch (e) { if (token === generation.current) fail(e) }
    finally { if (token === generation.current) setLoading(false) }
  }, [history, list])
  useEffect(() => {
    const guard = generation
    void reload()
    return () => { guard.current++ }
  }, [reload])
  const select = async (id: string) => {
    if (busy.current) return false
    const token = ++generation.current
    setLoading(true); setError('')
    try {
      const page = await history(id)
      if (token !== generation.current) return false
      await apiRequest(`/api/chat/threads/${encodeURIComponent(id)}`, { method: 'PATCH', ...json({ active: true }) })
      if (token !== generation.current) return false
      setActive(id); setTurns(page.turns); setCursor(page.next_cursor)
      return true
    } catch (e) { if (token === generation.current) fail(e); return false }
    finally { if (token === generation.current) setLoading(false) }
  }
  const create = async () => {
    if (busy.current || loading) return
    busy.current = true; setLoading(true); setError('')
    try {
      const { thread } = await apiRequest<{ thread: ChatThread }>('/api/chat/threads', { method: 'POST', ...json({ title: locale === 'zh' ? '新对话' : 'New conversation' }) })
      generation.current++; setThreads(old => [thread, ...old]); setActive(thread.id); setTurns([]); setCursor(null)
    } catch (e) { fail(e) }
    finally { busy.current = false; setLoading(false) }
  }
  const rename = async (title: string) => {
    if (!active || busy.current) return false
    busy.current = true; setError('')
    try {
      const { thread } = await apiRequest<{ thread: ChatThread }>(`/api/chat/threads/${encodeURIComponent(active)}`, { method: 'PATCH', ...json({ title }) })
      setThreads(old => old.map(item => item.id === thread.id ? thread : item)); return true
    } catch (e) { fail(e); return false }
    finally { busy.current = false }
  }
  const loadOlder = async () => {
    if (!active || !cursor || loading || busy.current) return
    const token = generation.current
    setLoading(true); setError('')
    try {
      const page = await history(active, cursor)
      if (token !== generation.current) return
      setTurns(old => [...page.turns.filter(turn => !old.some(item => item.id === turn.id)), ...old]); setCursor(page.next_cursor)
    } catch (e) { if (token === generation.current) fail(e) }
    finally { if (token === generation.current) setLoading(false) }
  }
  const text = drafts[active || ''] || ''
  const setText = useCallback((value: string) => setDrafts(old => ({ ...old, [active || '']: value })), [active])
  const send = async () => {
    const clean = text.trim()
    if (!active || !clean || busy.current || loading) return
    busy.current = true; setSending(true); setError('')
    const id = active
    const token = generation.current
    if (retry.current?.text !== clean || retry.current.thread !== id || retry.current.scope !== requestScope) retry.current = { text: clean, thread: id, id: requestId('chat'), scope: requestScope }
    try {
      await onSend(clean, id, retry.current.id)
      if (token !== generation.current) return
      setDrafts(old => ({ ...old, [id]: '' })); retry.current = null
      const page = await history(id)
      if (token !== generation.current) return
      setTurns(page.turns); setCursor(page.next_cursor)
      const result = await list(); if (token === generation.current) setThreads(result.threads)
    } catch (e) { if (token === generation.current) fail(e) }
    finally { busy.current = false; setSending(false) }
  }
  return { threads, active, turns, cursor, loading, sending, error, text, setText, select, create, rename, loadOlder, send, reload }
}
