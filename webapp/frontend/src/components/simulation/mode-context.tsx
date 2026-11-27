'use client'
import { createContext, useContext, type ReactNode } from 'react'
const SimulationMode = createContext(false)
export function SimulationModeProvider({ children }: { children: ReactNode }) {
  return (
    <SimulationMode.Provider value={true}>{children}</SimulationMode.Provider>
  )
}
export const useSimulationMode = () => useContext(SimulationMode)
