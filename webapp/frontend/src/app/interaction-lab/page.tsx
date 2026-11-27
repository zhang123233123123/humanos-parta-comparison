import { notFound } from 'next/navigation'
import { InteractionLab } from './scenario'
// This route cannot be enabled in a production build. It never changes normal auth.
export default function InteractionLabPage() {
  if (process.env.NODE_ENV === 'production' || process.env.HUMANOS_INTERACTION_LAB !== '1') notFound()
  return <InteractionLab />
}
