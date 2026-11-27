import { TaskDetailsDrawer } from '@/components/task-details-drawer'
import { ThemeProvider } from '@/components/theme-provider'
import { AppNavigation } from '@/components/app-navigation'
import { WorkspaceRuntimeRoot } from '@/components/workspace-runtime/provider'
import {
  RuntimeOverlays,
  RuntimeFloatingEntry,
} from '@/components/workspace-runtime/overlays'
import { Toaster } from '@/components/ui/sonner'
import { ReactNode } from 'react'
import { ModalProvider } from '@/hooks/use-modal'
import { GlobalAssistant } from '@/components/global-assistant'
import { DraftPlanEventSync } from '@/components/draft-plan-event-sync'
import { DemoBanner } from '@/components/demo-banner'
import { SimulationModeProvider } from '@/components/simulation/mode-context'

export default function AppLayout({ children }: { children: ReactNode }) {
  if (process.env.HUMANOS_SIMULATION_MODE === '1') {
    return (
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        forcedTheme="light"
        enableSystem={false}
      >
        <SimulationModeProvider>
          <div className="humanos-app min-h-dvh bg-background text-foreground">
            {children}
          </div>
        </SimulationModeProvider>
      </ThemeProvider>
    )
  }
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <WorkspaceRuntimeRoot>
        <ModalProvider>
          <Toaster />
          <div className="humanos-app relative h-dvh w-full flex flex-col overflow-hidden">
            <DemoBanner />
            <AppNavigation />
            <RuntimeOverlays />
            <TaskDetailsDrawer />
            <DraftPlanEventSync />
            <div className="h-full min-h-0 flex-1 overflow-hidden">
              {children}
            </div>
            <RuntimeFloatingEntry />
            <GlobalAssistant />
          </div>
        </ModalProvider>
      </WorkspaceRuntimeRoot>
    </ThemeProvider>
  )
}
