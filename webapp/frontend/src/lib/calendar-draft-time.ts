export function wallParts(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) + Number(parts.minute) / 60 }
}
export function draftInstant(week: string, day: number, hour: number, timezone: string) {
  const wall = Date.parse(`${week}T00:00:00Z`) + day * 86400000 + Math.round(hour * 60) * 60000
  let instant = wall
  for (let i = 0; i < 3; i++) {
    const parts = wallParts(new Date(instant), timezone)
    const represented = Date.parse(`${parts.date}T00:00:00Z`) + Math.round(parts.hour * 60) * 60000
    const difference = wall - represented
    if (!difference) return new Date(instant).toISOString()
    instant += difference
  }
  throw new Error('这个本地时间不存在，请检查夏令时切换。')
}
