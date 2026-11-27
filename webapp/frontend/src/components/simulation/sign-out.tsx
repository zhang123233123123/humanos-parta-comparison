'use client'
import { signOut } from 'next-auth/react'

export function SimulationSignOut() {
  return (
    <button
      className="text-sm text-slate-600 hover:text-indigo-700"
      onClick={() => void signOut({ callbackUrl: '/login' })}
    >
      退出登录
    </button>
  )
}
