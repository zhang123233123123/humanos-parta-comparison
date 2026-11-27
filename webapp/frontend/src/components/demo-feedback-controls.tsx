'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiRequest } from '@/lib/client/api'
import { DEMO_MODE } from '@/lib/demo/config'
import { usePlanPreview } from '@/hooks/use-plan-preview'

type Scenario = 'keep' | 'propose' | 'error'
type ScenarioResult = {
  scenario: Scenario
  fixture_loaded?: boolean
  source_session_id?: string
  local_date?: string
}
const scenarios: { value: Scenario; label: string }[] = [
  { value: 'keep', label: '保持安排' },
  { value: 'propose', label: '建议调整' },
  { value: 'error', label: '评估失败' },
]

// Only the explicitly enabled frontend preview mounts this control. Selecting an
// outcome is inert; replacing demo data requires the separate start action.
export function DemoFeedbackControls() {
  return DEMO_MODE ? <DemoFeedbackPanel /> : null
}

function DemoFeedbackPanel() {
  const router = useRouter()
  const [scenario, setScenario] = useState<Scenario>('propose')
  const [journey, setJourney] = useState('feedback')
  const [reading, setReading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const disclosure = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    let active = true
    apiRequest<{ data: ScenarioResult }>('/api/demo/interaction/scenario', { cache: 'no-store' })
      .then(({ data }) => {
        if (active && scenarios.some(item => item.value === data?.scenario)) setScenario(data.scenario)
      })
      .catch(() => { if (active) setError('未能读取演示选项，请重新选择后开始。') })
      .finally(() => { if (active) setReading(false) })
    return () => { active = false }
  }, [])

  async function start() {
    if (!DEMO_MODE || reading || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const { data } = await apiRequest<{ data: ScenarioResult }>('/api/demo/interaction/scenario', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario, journey }),
      })
      if (data?.scenario !== scenario || data.fixture_loaded !== true || !data.source_session_id || !/^\d{4}-\d{2}-\d{2}$/.test(data.local_date || '')) {
        throw new Error('没有收到演示准备结果，请重试。')
      }
      usePlanPreview.getState().clear()
      // AppContent may mount only after navigation from Settings or onboarding.
      // Keep this one-shot handoff within the explicitly enabled demo session.
      try { window.sessionStorage.setItem('humanos:demo-feedback-workspace', JSON.stringify(data)) } catch { /* The mounted workspace also receives the event. */ }
      if (disclosure.current) disclosure.current.open = false
      router.push('/app')
      window.dispatchEvent(new window.CustomEvent('humanos:demo-feedback-scenario', { detail: data }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '演示未能开始，请重试。')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return <details ref={disclosure} data-demo-controls="feedback" aria-label="反馈演示开发工具" className="relative shrink-0">
    <summary className="cursor-pointer underline">反馈演示</summary>
    <div className="absolute right-0 top-6 z-[100] w-64 space-y-3 whitespace-normal rounded border border-amber-200 bg-white p-3 text-foreground shadow">
      <p className="text-xs text-muted-foreground">仅替换本次演示数据。开始后填写反馈，查看对应结果。</p>
      <label className="grid gap-1 text-xs">每日使用场景<select aria-label="每日使用场景" className="h-8 rounded border bg-background px-2" value={journey} onChange={e => setJourney(e.target.value)}><option value="feedback">计划结束，尚未开始</option><option value="daily">次日首次进入，未填状态</option><option value="onboarded">当天已登记，从开始工作体验</option></select></label>
      <label className="grid gap-1 text-xs">演示时间<select aria-label="演示时间" className="h-8 rounded border bg-background px-2" defaultValue="" onChange={async e => {
        const value = e.target.value; if (!value) return
        try { await apiRequest('/api/demo/interaction/clock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hour: Number(value) % 24, day: Number(value) >= 24 ? 1 : 0 }) }); window.dispatchEvent(new Event('humanos:daily-state-saved')); if (disclosure.current) disclosure.current.open = false }
        catch { setError('请先开始演示，再调整时间。') }
      }}><option value="">选择时间推进</option><option value="9.75">09:45 第一段结束</option><option value="11">11:00 下一工作段开始</option><option value="13">13:00 固定会议开始</option><option value="13.666666667">13:40 提前开始14点工作</option><option value="32.5">次日 08:30</option></select></label>
      <label className="block space-y-1.5 text-xs">
        <span>反馈结果</span>
        <select className="h-8 w-full rounded border bg-background px-2" aria-label="反馈演示结果" value={scenario} disabled={reading || busy} onChange={event => setScenario(event.target.value as Scenario)}>
          {scenarios.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <button type="button" disabled={reading || busy} onClick={start} className="rounded border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-50">{busy ? '正在准备…' : '开始演示'}</button>
    </div>
  </details>
}
