'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

type Position = { x: number; y: number }

export function clampAssistantPosition(position: Position, width: number, height: number, viewportWidth: number, viewportHeight: number): Position {
  const margin = 8
  return {
    x: Math.max(margin, Math.min(position.x, viewportWidth - width - margin)),
    y: Math.max(margin, Math.min(position.y, viewportHeight - height - margin)),
  }
}

export function DraggableAssistantEntry({ disabled, onOpen, locale }: { disabled: boolean; onOpen: () => void; locale: string }) {
  const element = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ id: number; pointer: Position; origin: Position } | null>(null)
  const suppressClick = useRef(false)
  const [position, setPosition] = useState<Position | null>(null)

  const move = (next: Position) => {
    const rect = element.current?.getBoundingClientRect()
    if (rect) setPosition(clampAssistantPosition(next, rect.width, rect.height, window.innerWidth, window.innerHeight))
  }
  useEffect(() => {
    const resize = () => {
      const rect = element.current?.getBoundingClientRect()
      if (rect) move({ x: rect.left, y: rect.top })
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  return <div ref={element} id="workspace-guide-floating" tabIndex={-1}
    className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-40 w-fit sm:right-6"
    style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}>
    <Button type="button" variant="outline" disabled={disabled}
      className="touch-none select-none rounded-full bg-background shadow-md cursor-grab active:cursor-grabbing"
      title={locale === 'zh' ? '点击打开，拖动调整位置；方向键也可移动' : 'Click to open, drag or use arrow keys to move'}
      onPointerDown={event => {
        if (disabled || event.button !== 0 || gesture.current) return
        const rect = element.current?.getBoundingClientRect()
        if (!rect) return
        suppressClick.current = false
        gesture.current = { id: event.pointerId, pointer: { x: event.clientX, y: event.clientY }, origin: { x: rect.left, y: rect.top } }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={event => {
        const drag = gesture.current
        if (disabled || !drag || drag.id !== event.pointerId) return
        const dx = event.clientX - drag.pointer.x, dy = event.clientY - drag.pointer.y
        if (!suppressClick.current && Math.hypot(dx, dy) < 6) return
        suppressClick.current = true
        move({ x: drag.origin.x + dx, y: drag.origin.y + dy })
      }}
      onPointerUp={event => {
        if (gesture.current?.id !== event.pointerId) return
        gesture.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => { gesture.current = null; suppressClick.current = true }}
      onLostPointerCapture={() => { gesture.current = null }}
      onKeyDown={event => {
        if (disabled) return
        if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false
        const offsets: Record<string, Position> = { ArrowLeft: { x: -16, y: 0 }, ArrowRight: { x: 16, y: 0 }, ArrowUp: { x: 0, y: -16 }, ArrowDown: { x: 0, y: 16 } }
        const offset = offsets[event.key], rect = element.current?.getBoundingClientRect()
        if (offset && rect) { event.preventDefault(); move({ x: rect.left + offset.x, y: rect.top + offset.y }) }
      }}
      onClick={event => {
        if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); return }
        if (!disabled) onOpen()
      }}>HumanOS</Button>
  </div>
}
