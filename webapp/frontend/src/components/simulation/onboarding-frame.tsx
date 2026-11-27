'use client'

import { ReactNode, useEffect, useRef } from 'react'
import { WorkspaceNavigationFrame } from '@/components/workspace-navigation-frame'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SimulationSignOut } from './sign-out'
import { SimulationTour, START_SIMULATION_TOUR } from './tour'

export function OnboardingFrame({
  step,
  userId,
  scope,
  title,
  description,
  children,
}: {
  step: number
  userId: string
  scope: string
  title: string
  description: string
  children: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const previous = useRef(step)
  useEffect(() => {
    if (previous.current !== step) {
      scroller.current?.scrollTo({
        top: 0,
        behavior: 'instant' as ScrollBehavior,
      })
      heading.current?.focus({ preventScroll: true })
      previous.current = step
    }
  }, [step])
  return (
    <main
      data-simulation-app
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground"
    >
      <WorkspaceNavigationFrame>
        <span className="flex-1 text-sm text-muted-foreground">首次设置</span>
        <button
          className="mr-4 text-sm text-primary"
          onClick={() => window.dispatchEvent(new Event(START_SIMULATION_TOUR))}
        >
          ↖ 操作引导
        </button>
        <SimulationSignOut />
      </WorkspaceNavigationFrame>
      <SimulationTour scope={scope} userId={userId} />
      <div
        ref={scroller}
        data-profile-scroll
        tabIndex={0}
        aria-label="首次设置填写区域"
        className="humanos-onboarding min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain scroll-auto p-4 pb-12 outline-none md:p-10 md:pb-16"
      >
        <Card className="mx-auto max-w-4xl overflow-hidden border-border bg-card text-foreground shadow-none">
          <CardHeader className="border-b p-6 md:px-10 md:pt-9">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  让 HumanOS 了解你
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  填写个人情况、可用时间和任务，再查看为你生成的安排。
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                第 {step + 1} / 4 步
              </Badge>
            </div>
            <ol
              data-tour="setup-progress"
              className="humanos-onboarding-progress mt-6 grid grid-cols-4 gap-3 text-xs text-muted-foreground"
              aria-label="设置进度"
            >
              {['了解你', '工作节奏', '可用时间', '任务与状态'].map(
                (label, i) => (
                  <li
                    key={label}
                    data-complete={i <= step}
                    aria-current={i === step ? 'step' : undefined}
                  >
                    <span className="mr-1.5 tabular-nums">{i + 1}.</span>
                    {label}
                  </li>
                ),
              )}
            </ol>
          </CardHeader>
          <CardContent className="p-6 md:p-10">
            <h2
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight outline-none"
            >
              {title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            {children}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
