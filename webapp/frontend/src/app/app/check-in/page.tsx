'use client'
import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useWorkspaceRuntime } from '@/components/workspace-runtime/provider'
export default function CheckInBridge() {
  const runtime = useWorkspaceRuntime(); const router = useRouter(); const opened = useRef(false)
  useEffect(() => { if (!runtime || opened.current) return; opened.current = true; runtime.open({kind:'state', id:'manual-state', source:'manual'}); router.replace('/app') }, [runtime, router])
  return null
}
