import { ChoicePicker } from './choice-picker'

export function ProfilePicker(props: {
  value: string
  options: string[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <ChoicePicker
      {...props}
      label="历史 Profile"
      options={props.options.map((value) => ({ value, label: value }))}
    />
  )
}
