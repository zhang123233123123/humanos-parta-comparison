'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tours } from './tour-steps'
import { controlSteps, type ControlStep } from './control-help'

export const START_SIMULATION_TOUR = 'humanos:start-simulation-tour'
type Box = { top: number; left: number; width: number; height: number }
const selector = (target: string) =>
  target.startsWith('control:')
    ? `[data-tour-control="${target.slice(8)}"]`
    : `[data-tour="${target}"]`
function findTarget(target: string) {
  // A dialog can contain its own copy of a page control. Never point behind it.
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[data-runtime-dialog]'),
  )
  const dialog = dialogs.reverse().find((el) => el.getClientRects().length)
  return (
    Array.from(
      (dialog || document).querySelectorAll<HTMLElement>(selector(target)),
    ).find(
      (el) =>
        el.getClientRects().length &&
        !el.closest('[hidden],[inert],[aria-hidden="true"]') &&
        getComputedStyle(el).visibility === 'visible' &&
        getComputedStyle(el).display !== 'none',
    ) || null
  )
}

function viewport() {
  const v = window.visualViewport
  return {
    left: v?.offsetLeft || 0,
    top: v?.offsetTop || 0,
    width: v?.width || window.innerWidth,
    height: v?.height || window.innerHeight,
  }
}

/** Read-only guidance: no API calls, synthetic clicks, answer changes or plan mutations. */
export function SimulationTour({
  scope,
  userId,
  ready = true,
}: {
  scope: string
  userId: string
  ready?: boolean
}) {
  // Reset the tour when the actual workflow changes, never on a polling revision.
  return (
    <TourSession
      key={`${userId}:${scope}`}
      scope={scope}
      userId={userId}
      ready={ready}
    />
  )
}

function TourSession({
  scope,
  userId,
  ready,
}: {
  scope: string
  userId: string
  ready: boolean
}) {
  const [detailMode, setDetailMode] = useState(false)
  const [details, setDetails] = useState<ControlStep[]>([])
  const steps = detailMode ? details : tours[scope] || []
  const storageKey = `humanos:simulation-tour:v2:${userId}:${scope}`
  const [active, setActive] = useState(false)
  const [reopenRevision, setReopenRevision] = useState(0)
  const [available, setAvailable] = useState<number[]>([])
  const [index, setIndex] = useState(0)
  const selectedDetailTarget = useRef<string | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [cardBox, setCardBox] = useState({
    top: 16,
    left: 16,
    below: true,
    width: 360,
    maxHeight: 480,
  })
  const card = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const initialized = useRef(false)
  const targets = useRef<HTMLElement[]>([])
  const availableRef = useRef<number[]>([])
  const stepIndex =
    available[Math.min(index, Math.max(0, available.length - 1))]
  const current = steps[stepIndex]
  const goTo = (next: number) => {
    if (detailMode)
      selectedDetailTarget.current = steps[available[next]]?.target || null
    setIndex(next)
  }

  const remember = () => {
    try {
      localStorage.setItem(storageKey, 'seen')
    } catch {
      /* Private browsers can disallow storage. */
    }
  }
  const close = () => {
    remember()
    if (card.current?.contains(document.activeElement))
      previousFocus.current?.isConnected &&
        previousFocus.current.focus({ preventScroll: true })
    setActive(false)
  }

  useEffect(() => {
    if (!ready || !active) return
    const collect = () => {
      const next = controlSteps()
      setDetails((old) =>
        JSON.stringify(old) === JSON.stringify(next) ? old : next,
      )
    }
    collect()
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (r) =>
            !(
              r.target instanceof HTMLElement &&
              r.target.closest('[data-simulation-tour]')
            ),
        )
      )
        collect()
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'hidden',
        'class',
        'style',
        'aria-hidden',
        'data-help',
        'data-help-question',
        'data-help-text',
      ],
    })
    window.addEventListener('resize', collect)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', collect)
    }
  }, [ready, active])

  useEffect(() => {
    if (!ready) return
    const refresh = () => {
      const found = steps.map((s) => findTarget(s.target))
      const next = found.flatMap((el, i) => (el ? [i] : []))
      const elements = found.filter((el): el is HTMLElement => !!el)
      if (
        next.length !== availableRef.current.length ||
        next.some((n, i) => n !== availableRef.current[i]) ||
        elements.length !== targets.current.length ||
        elements.some((el, i) => el !== targets.current[i])
      ) {
        targets.current = elements
        const previous = availableRef.current
        setIndex((i) => {
          const same = detailMode
            ? next.findIndex(
                (n) => steps[n].target === selectedDetailTarget.current,
              )
            : next.indexOf(previous[i])
          return same >= 0 ? same : Math.max(0, Math.min(i, next.length - 1))
        })
        availableRef.current = next
        setAvailable(next)
      }
      if (!initialized.current && next.length) {
        initialized.current = true
        const requested =
          new URLSearchParams(location.search).get('tour') === '1'
        let seen = false
        try {
          seen = localStorage.getItem(storageKey) === 'seen'
        } catch {}
        if (requested || !seen) {
          previousFocus.current = document.activeElement as HTMLElement
          setActive(true)
          try {
            localStorage.setItem(storageKey, 'seen')
          } catch {}
        }
        if (requested) {
          const url = new URL(location.href)
          url.searchParams.delete('tour')
          history.replaceState(history.state, '', url)
        }
      }
    }
    refresh()
    // Observe portals and responsive visibility too; ignore our own overlay writes.
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (r) =>
            !(
              r.target instanceof HTMLElement &&
              r.target.closest('[data-simulation-tour]')
            ),
        )
      )
        refresh()
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'hidden',
        'data-tour',
        'class',
        'style',
        'aria-hidden',
        'inert',
      ],
    })
    const restart = () => {
      refresh()
      setReopenRevision((n) => n + 1)
      previousFocus.current = document.activeElement as HTMLElement
      selectedDetailTarget.current = null
      setIndex(0)
      setActive(true)
    }
    window.addEventListener('resize', refresh)
    window.addEventListener(START_SIMULATION_TOUR, restart)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', refresh)
      window.removeEventListener(START_SIMULATION_TOUR, restart)
    }
  }, [ready, scope, steps, storageKey])

  useLayoutEffect(() => {
    if (!active || !current) {
      setBox(null)
      return
    }
    const el = findTarget(current.target)
    if (!el) {
      setBox(null)
      return
    }
    el.scrollIntoView({
      block: 'center',
      inline: 'nearest',
      behavior: 'instant' as ScrollBehavior,
    })
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!el.isConnected || !findTarget(current.target)) {
          setBox(null)
          return
        }
        const v = viewport()
        const r = el.getBoundingClientRect()
        let left = Math.max(v.left + 6, r.left - 5),
          top = Math.max(v.top + 6, r.top - 5)
        let right = Math.min(v.left + v.width - 6, r.right + 5)
        let bottom = Math.min(v.top + v.height - 6, r.bottom + 5)
        // Clip to scroll containers: off-screen controls must not get a stale highlight.
        for (
          let parent = el.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          const style = getComputedStyle(parent),
            clip = parent.getBoundingClientRect()
          if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
            top = Math.max(top, clip.top)
            bottom = Math.min(bottom, clip.bottom)
          }
          if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
            left = Math.max(left, clip.left)
            right = Math.min(right, clip.right)
          }
        }
        const rect = {
          top,
          left,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        }
        const cw = Math.min(360, v.width - 24)
        const aboveSpace = top - v.top - 24
        const belowSpace = v.top + v.height - bottom - 24
        const sideRoom =
          right + cw + 30 <= v.left + v.width || left - cw - 30 >= v.left
        const maxHeight = Math.max(
          100,
          Math.min(
            v.height - 26,
            sideRoom
              ? v.height - 26
              : Math.max(aboveSpace, belowSpace, 160) - 2,
          ),
        )
        const ch = Math.min(card.current?.offsetHeight || 240, maxHeight)
        const below =
          belowSpace >= ch || (aboveSpace < ch && belowSpace >= aboveSpace)
        let cx = Math.max(
          v.left + 12,
          Math.min(v.left + v.width - cw - 12, left),
        )
        let cy = below ? bottom + 18 : top - ch - 18
        // On wide screens place the card alongside large form sections when possible.
        if (
          belowSpace < ch &&
          aboveSpace < ch &&
          right + cw + 30 <= v.left + v.width
        ) {
          cx = right + 18
          cy = top
        } else if (
          belowSpace < ch &&
          aboveSpace < ch &&
          left - cw - 30 >= v.left
        ) {
          cx = left - cw - 18
          cy = top
        }
        cy = Math.max(v.top + 12, Math.min(v.top + v.height - ch - 12, cy))
        setBox(rect)
        setCardBox({ left: cx, top: cy, below, width: cw, maxHeight })
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (card.current) observer.observe(card.current)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [active, current, available, reopenRevision])

  useEffect(() => {
    if (!active) return
    // Do not steal focus from text fields while a participant is answering.
    const focus = document.activeElement
    if (
      !(focus instanceof HTMLElement) ||
      !focus.matches('input,textarea,select,[contenteditable="true"]')
    )
      card.current?.focus({ preventScroll: true })
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
    // The scope is remounted when its workflow changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (!active || !current || typeof document === 'undefined') return null
  return createPortal(
    <div
      data-simulation-tour
      className="pointer-events-none fixed inset-0 z-[100] print:hidden"
    >
      {box && box.width > 0 && box.height > 0 && (
        <>
          <div
            aria-hidden="true"
            className="fixed rounded-xl border-[3px] border-indigo-500"
            style={{ ...box, boxShadow: '0 0 0 9999px rgba(15,23,42,.26)' }}
          />
          <svg
            aria-hidden="true"
            className="fixed h-9 w-9 text-indigo-600 drop-shadow-md"
            style={{
              left: Math.max(
                8,
                Math.min(innerWidth - 40, box.left + box.width - 16),
              ),
              top: Math.max(
                8,
                Math.min(
                  innerHeight - 40,
                  box.top + Math.min(box.height, 32) - 12,
                ),
              ),
            }}
            viewBox="0 0 32 32"
            fill="currentColor"
          >
            <path
              d="M5 2L27 18L17 20L12 30L5 2Z"
              stroke="white"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </>
      )}
      <div
        ref={card}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby="simulation-tour-title"
        aria-describedby="simulation-tour-description"
        className="pointer-events-auto fixed w-[360px] max-w-[calc(100vw-24px)] rounded-2xl border border-indigo-200 bg-white text-slate-900 shadow-2xl outline-none"
        style={{
          top: cardBox.top,
          left: cardBox.left,
          width: cardBox.width,
          visibility:
            box && box.width > 0 && box.height > 0 ? 'visible' : 'hidden',
        }}
      >
        <div
          className="relative overflow-y-auto p-4 sm:p-5"
          style={{ maxHeight: cardBox.maxHeight }}
        >
          <div className="mb-3 flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-indigo-700">
              {scope.startsWith('participant')
                ? '参与者操作引导'
                : '研究者操作引导'}{' '}
              · {Math.min(index + 1, available.length)} / {available.length}
            </span>
            <button
              type="button"
              onClick={close}
              className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100"
              aria-label="跳过操作引导"
            >
              跳过 ×
            </button>
          </div>
          <div className="mb-3 flex gap-2 text-xs" aria-label="指引方式">
            <button
              type="button"
              aria-pressed={!detailMode}
              className="rounded border px-2 py-1 aria-pressed:border-indigo-500 aria-pressed:text-indigo-700"
              onClick={() => {
                selectedDetailTarget.current = null
                setDetailMode(false)
                setIndex(0)
                availableRef.current = []
                targets.current = []
              }}
            >
              流程指引
            </button>
            <button
              type="button"
              aria-pressed={detailMode}
              disabled={!details.length}
              className="rounded border px-2 py-1 aria-pressed:border-indigo-500 aria-pressed:text-indigo-700 disabled:opacity-40"
              onClick={() => {
                selectedDetailTarget.current = details[0]?.target || null
                setDetailMode(true)
                setIndex(0)
                availableRef.current = []
                targets.current = []
              }}
            >
              逐项说明
            </button>
          </div>
          {detailMode && (
            <label className="mb-3 block text-xs text-slate-600">
              选择要了解的控件
              <select
                aria-label="选择要了解的控件"
                className="mt-1 block w-full rounded border bg-white p-2 text-sm"
                value={stepIndex ?? 0}
                onChange={(e) =>
                  goTo(available.indexOf(Number(e.target.value)))
                }
              >
                {available
                  .filter((n) => !!steps[n])
                  .map((n, i) => (
                    <option key={steps[n].target} value={n}>
                      {i + 1}. {steps[n].title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <h2 id="simulation-tour-title" className="text-lg font-semibold">
            {current.title}
          </h2>
          <p
            id="simulation-tour-description"
            className="mt-2 text-sm leading-6 text-slate-600"
            aria-live="polite"
          >
            {current.text}
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            可直接操作高亮位置，也可先点“下一步”浏览。引导不会替你提交或保存。
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => goTo(Math.max(0, index - 1))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40"
            >
              上一步
            </button>
            <button
              type="button"
              onClick={() =>
                index >= available.length - 1 ? close() : goTo(index + 1)
              }
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              {index >= available.length - 1 ? '完成引导' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
