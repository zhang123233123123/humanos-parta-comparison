'use client'
import Link from 'next/link'
import { WorkspaceNavigationFrame } from '@/components/workspace-navigation-frame'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CalendarDays, Clock3, Lightbulb, LogOut, Moon, Settings2, ShieldCheck, Sun, UserRound, type LucideIcon } from 'lucide-react'
import { signOut, useSession } from 'next-auth/react'
import { useTheme } from 'next-themes'
import { useTranslation } from '@/i18n/LanguageProvider'
import { DailyStateLink } from '@/components/daily-state-link'
import { LanguageSwitch } from '@/components/language-switch'
import { RuntimeNotifications } from '@/components/workspace-runtime/overlays'

export function AppNavigation() {
  const { theme, setTheme } = useTheme()
  const pathname = usePathname(); const { locale } = useTranslation(); const { data: session } = useSession(); const [qa, setQa] = useState(false)
  useEffect(() => { fetch('/api/account/capabilities', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((b) => setQa(Boolean(b?.qa_tools))).catch(() => setQa(false)) }, [])
  const items: Array<[string, string, LucideIcon]> = [
    ['/app', locale === 'zh' ? '工作台' : 'Workspace', CalendarDays], ['/app/plan', locale === 'zh' ? '周计划' : 'Weekly Plan', Clock3],
    ['/app/insights', locale === 'zh' ? '洞察' : 'Insights', Lightbulb], ['/app/settings', locale === 'zh' ? '设置' : 'Settings', Settings2],
  ]
  if (qa) items.push(['/app/qa', 'QA', ShieldCheck])
  const email = session?.user?.email || ''
  const accountLabel = session?.user?.name || email || (locale === 'zh' ? '账户' : 'Account')
  return <WorkspaceNavigationFrame><nav className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto sm:gap-3">{items.map(([href, label, Icon]) => { const active = href === '/app' ? pathname === href : pathname.startsWith(href); return <Link id={`guide-nav-${href.split('/').pop()}`} key={href} href={href} aria-label={label} aria-current={active ? 'page' : undefined} title={label} className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-xs transition sm:px-3 ${active ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="h-4 w-4" /><span className="hidden md:inline">{label}</span></Link> })}{pathname !== '/app' && <DailyStateLink />}</nav><div className="ml-2 flex shrink-0 items-center gap-1"><RuntimeNotifications /><LanguageSwitch /><details className="group relative"><summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border bg-card text-foreground shadow-sm transition hover:border-primary/50 hover:bg-muted [&::-webkit-details-marker]:hidden" aria-label={locale === 'zh' ? '打开账户菜单' : 'Open account menu'} title={accountLabel}><UserRound className="h-4 w-4" /></summary><div className="absolute right-0 top-11 z-[80] w-64 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"><div className="border-b bg-muted/30 px-4 py-3"><p className="truncate text-sm font-semibold">{accountLabel}</p>{email && <p className="mt-0.5 truncate text-xs text-muted-foreground">{email}</p>}</div><div className="p-2"><Link href="/app/settings" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted"><Settings2 className="h-4 w-4" />{locale === 'zh' ? '账户与设置' : 'Account & Settings'}</Link><button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted">{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}{locale === 'zh' ? '切换明暗主题' : 'Switch light / dark theme'}</button><button type="button" onClick={() => void signOut({ callbackUrl: '/login' })} className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"><LogOut className="h-4 w-4" />{locale === 'zh' ? '退出登录' : 'Sign out'}</button></div></div></details></div></WorkspaceNavigationFrame>
}
