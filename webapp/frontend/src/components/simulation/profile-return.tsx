'use client'
import { useEffect, useState } from 'react'
import type { ParticipantProfile } from '@/lib/contracts/simulation-contracts'
import { ProfileSetup } from './profile'
import { api, Button } from './common'

/** The caller remains mounted, so task/time drafts survive a visit to pages 1–2. */
export function ProfileReturn({
  userId,
  onSaved,
  onCancel,
}: {
  userId: string
  onSaved: (p: ParticipantProfile) => void
  onCancel: () => void
}) {
  const [profile, setProfile] = useState<ParticipantProfile | null>(null)
  const [error, setError] = useState('')
  const load = () => {
    setError('')
    api<ParticipantProfile>('profile')
      .then(setProfile)
      .catch((e) => setError(e.message))
  }
  useEffect(load, [])
  if (!profile)
    return (
      <div className="space-y-4 p-8">
        <p role={error ? 'alert' : 'status'}>
          {error || '正在读取已保存的个人资料…'}
        </p>
        {error && <Button onClick={load}>重试</Button>}
        <Button secondary onClick={onCancel}>
          返回可用时间
        </Button>
      </div>
    )
  return (
    <ProfileSetup
      profile={profile}
      userId={userId}
      initialStep={1}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  )
}
