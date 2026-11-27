'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'

/** Bounded web menu: avoids platform-native select popup scaling. */
export function ChoicePicker({
  value,
  label,
  placeholder = '请选择',
  className = '',
  options,
  disabled,
  onChange,
}: {
  value: string
  label: string
  placeholder?: string
  className?: string
  options: { value: string; label: string }[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const selected =
    options.find((option) => option.value === value)?.label || placeholder
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}：${selected}`}
          title={selected}
          disabled={disabled}
          className={`flex min-w-0 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm leading-5 text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 ${className}`}
        >
          <span className="min-w-0 truncate">{selected}</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-slate-500"
            aria-hidden="true"
          />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={5}
          collisionPadding={12}
          className="z-50 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white p-1 text-sm leading-5 text-slate-900 shadow-lg outline-none [color-scheme:light]"
          style={{
            width: 'var(--radix-dropdown-menu-trigger-width)',
            maxWidth: 'calc(100vw - 24px)',
            maxHeight:
              'min(280px, var(--radix-dropdown-menu-content-available-height))',
          }}
        >
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={onChange}
            aria-label={`选择${label}`}
          >
            {options.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                className="relative flex cursor-pointer select-none items-center rounded-md py-2 pl-9 pr-3 outline-none data-[highlighted]:bg-indigo-50 data-[highlighted]:text-indigo-700 data-[state=checked]:font-semibold"
              >
                <DropdownMenu.ItemIndicator className="absolute left-3">
                  <Check
                    className="h-4 w-4 text-indigo-600"
                    aria-hidden="true"
                  />
                </DropdownMenu.ItemIndicator>
                <span className="min-w-0 break-words">{option.label}</span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
