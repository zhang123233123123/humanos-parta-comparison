import { notFound } from 'next/navigation'
import { SimulationApp } from '@/components/simulation/app'
export const dynamic = 'force-dynamic'
export default function Page({ params }: { params: { path?: string[] } }) {
  if (process.env.HUMANOS_SIMULATION_MODE !== '1') notFound()
  return <SimulationApp path={params.path || []} />
}
