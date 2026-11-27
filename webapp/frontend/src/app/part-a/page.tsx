import { getPartAActor } from '@/lib/server/part-a-access'
import PartAWorkbench from '@/components/part-a/workbench'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false }, referrer: 'no-referrer' as const }

export default async function PartAPage() {
  if (process.env.HUMANOS_PARTA_MODE !== '1') {
    return (
      <main className="p-12 text-slate-900 bg-white min-h-screen">
        <h1 className="text-2xl font-bold">Part A 内部预试</h1>
        <p className="mt-4">此实例尚未启用比较工具。</p>
      </main>
    )
  }
  if (!getPartAActor()) return (
    <main className="p-12 text-slate-900 bg-white min-h-screen">
      <h1 className="text-2xl font-bold">Part A 内部预试</h1>
      <p className="mt-4">请通过专属访问链接进入，无需注册或登录账号。</p>
    </main>
  )
  return <PartAWorkbench />
}
