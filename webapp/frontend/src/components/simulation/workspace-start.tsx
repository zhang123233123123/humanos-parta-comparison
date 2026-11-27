'use client'
import { useEffect, useRef, useState } from 'react'
import type { SimRun } from '@/lib/contracts/simulation-contracts'
import { api, mutation } from './common'
import { Button } from '@/components/ui/button'
import { SimulationSignOut } from './sign-out'

export function WorkspaceStart({ onReady, onEdit }: {
  onReady: (id: string) => void
  onEdit: () => void
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const request = useRef(mutation({}))
  const ready = useRef(onReady)
  ready.current = onReady
  async function start() {
    setBusy(true)
    setError('')
    try {
      const run = await api<SimRun>('workspace/start', 'POST', request.current)
      ready.current(run.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { void start() }, [])
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-xl font-semibold">HumanOS</h1>
      <p role={error ? 'alert' : 'status'}>
        {error || '正在载入你已保存的任务、可用时间和状态…'}
      </p>
      {error && <>
        <p className="text-sm text-muted-foreground">已保存的资料保留，进入工作台后由你生成并确认计划。</p>
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => void start()}>重试进入工作台</Button>
          <Button disabled={busy} variant="outline" onClick={onEdit}>修改任务与时间设置</Button>
        </div>
      </>}
      <SimulationSignOut />
    </main>
  )
}
