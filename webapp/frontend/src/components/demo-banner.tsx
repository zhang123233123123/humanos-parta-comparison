'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { DEMO_MODE } from '@/lib/demo/config'
import { DemoFeedbackControls } from '@/components/demo-feedback-controls'

export function DemoBanner() {
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    if (!DEMO_MODE) return
    const show = () => setConfirmed(true)
    const reset = () => setConfirmed(false)
    window.addEventListener('humanos:demo-confirmed', show)
    window.addEventListener('humanos:demo-feedback-scenario', reset)
    return () => {
      window.removeEventListener('humanos:demo-confirmed', show)
      window.removeEventListener('humanos:demo-feedback-scenario', reset)
    }
  }, [])
  if (!DEMO_MODE) return null
  return <div role="toolbar" aria-label="前端演示工具栏" data-demo-toolbar="true" className="z-[90] flex h-8 shrink-0 items-center gap-3 whitespace-nowrap border-b border-amber-300 bg-amber-50 px-3 text-[11px] sm:px-4 text-amber-950">
    <strong className="shrink-0 font-medium">演示模式 · 数据仅供预览</strong>
    <Link className="hidden underline sm:inline" href="/app">日历预览</Link>
    <span className="ml-auto" />
    <DemoFeedbackControls />
    <button className="shrink-0 underline" onClick={() => { sessionStorage.clear(); window.location.assign('/app/onboarding?edit=1') }}>重置演示</button>
    <details className="relative"><summary className="cursor-pointer underline">如何退出</summary><p className="absolute right-0 top-6 z-[100] w-64 whitespace-normal rounded border bg-white p-3 shadow">关闭此预览页，停止 dev:demo。运行 npm run dev 后打开 localhost:3000，即恢复正式模式。</p></details>
    {confirmed && <span role="status" className="hidden min-w-0 truncate font-medium lg:inline">已确认演示计划，未写入真实日历</span>}
  </div>
}
