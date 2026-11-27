'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Preserve previously shared tutorial links by opening the interactive guide. */
export function SimulationGuide() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/app/simulation/research?tour=1')
  }, [router])
  return (
    <p role="status" className="p-6 text-slate-600">
      正在打开研究者操作引导…
    </p>
  )
}
