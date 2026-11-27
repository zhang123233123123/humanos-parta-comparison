'use client'
import { create } from 'zustand'
import type { PlanDecision } from '@/lib/contracts/planning-contracts'
import type { HumanOSTask } from '@/lib/contracts/task-contracts'

export const planVersion = (p: PlanDecision | null) => p ? `${p.plan_id}:${p.plan_revision || 0}` : ''
export const blockKey = (b: any) => [b.task_id, b.day_index, b.start, b.end, b.planned_work_minutes ?? b.session_minutes].join('|')

type Preview = {
  plan: PlanDecision | null; base: PlanDecision | null; original: boolean; selected: string; stale: boolean
  storageKey: string; stateId: string | null; titles: Record<string, string>; timezone: string
  tasks: Record<string, HumanOSTask>
  confirmedVersion: string
  load: (plan: PlanDecision | null, base: PlanDecision | null, account: string, stateId: string | null, titles: Record<string,string>, timezone?: string, tasks?: Record<string, HumanOSTask>) => void
  edit: (blockId: string, day: number, start: number, end: number) => void
  select: (id: string) => void
  toggle: () => void
  clear: (confirmedPlan?: PlanDecision) => void
}
export const usePlanPreview = create<Preview>((set, get) => ({
  plan: null, base: null, original: false, selected: '', stale: false, storageKey: '', stateId: null, titles: {}, tasks: {}, timezone: 'UTC', confirmedVersion: '',
  load(plan, base, account, stateId, titles, timezone = 'UTC', tasks = {}) {
    set({ timezone, tasks })
    if (plan && planVersion(plan) === get().confirmedVersion) { set({ plan: null, base, selected: '', stale: false }); return }
    const key = `humanos:calendar-draft:${encodeURIComponent(account)}:${planVersion(plan)}`
    if (get().storageKey === key && planVersion(plan) === planVersion(get().plan)) {
      const current = get().plan
      set({ plan: current && plan ? { ...current, unscheduled_tasks: plan.unscheduled_tasks } : current, base, titles, stale: get().stale || get().stateId !== stateId || planVersion(base) !== planVersion(get().base) }); return
    }
    let edited = plan
    let savedState = stateId
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); if (saved?.plan && planVersion(saved.plan) === planVersion(plan)) { edited = { ...saved.plan, unscheduled_tasks: plan?.unscheduled_tasks }; savedState = saved.stateId } } catch { /* server proposal remains available */ }
    const evidence = plan?.personalization?.current_state_evidence
    set({ plan: edited, base, storageKey: key, titles, stateId: savedState, selected: '', original: false,
      stale: savedState !== stateId || Boolean(evidence?.state_id && evidence.state_id !== stateId) })
  },
  edit(blockId, day, start, end) {
    if (get().stale || get().original) throw new Error('请先重新生成候选计划或切回候选视图，再调整草案。')
    const { plan, storageKey, stateId } = get()
    if (!plan || !Number.isInteger(day) || day < 0 || day > 6 || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 24 || end <= start) throw new Error('请选择规划期内有效的开始和结束时间。')
    const block = plan.plan_patch.find(b => b.block_id === blockId)
    if (!block || block.kind === 'flexible_activity') throw new Error('此活动请通过“修改计划依据”调整。')
    if ((end - start) * 60 + 0.01 < Number(block.planned_work_minutes ?? block.session_minutes ?? 0)) throw new Error('日历时长不能小于本段工作分钟。')
    // Keep work amount intact; backend validates constraints on the final patch.
    const edited = { ...plan, plan_patch: plan.plan_patch.map(b => {
      if (b.block_id !== blockId) return b
      const { start_at, end_at, week_start_minute, week_end_minute, ...rest } = b
      return { ...rest, day_index: day, start, end, week_start_minute: day * 1440 + Math.round(start * 60), week_end_minute: day * 1440 + Math.round(end * 60) }
    }) }
    localStorage.setItem(storageKey, JSON.stringify({ plan: edited, stateId }))
    set({ plan: edited }); window.dispatchEvent(new Event('humanos:draft-edited'))
  },
  select: selected => set({ selected }),
  toggle: () => { set({ original: !get().original }); window.dispatchEvent(new Event('humanos:draft-edited')) },
  clear: confirmedPlan => {
    try { if (get().storageKey) localStorage.removeItem(get().storageKey) } catch { /* A storage cleanup failure cannot undo verified persistence. */ }
    set({ plan: null, selected: '', stale: false,
      ...(confirmedPlan?.plan_status === 'confirmed' ? { confirmedVersion: planVersion(confirmedPlan) } : {}) })
  },
}))
