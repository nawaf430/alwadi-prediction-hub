'use client'

import { useEffect, useState } from 'react'

export function CountdownTimer({ deadline }: { deadline: string }) {
  const [display, setDisplay] = useState<string | null>(null)
  const [urgent, setUrgent] = useState(false)

  useEffect(() => {
    function tick() {
      const diff = new Date(deadline).getTime() - Date.now()
      if (diff <= 0) { setDisplay(null); return }
      setUrgent(diff < 30 * 60 * 1000) // red under 30 min
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setDisplay(h > 0 ? `${h}س ${m}د` : `${m}د ${s}ث`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])

  if (!display) return null

  return (
    <span className={`text-sm font-mono font-semibold tabular-nums ${urgent ? 'text-[#ef4444]' : 'text-[#f97316]'}`}>
      ⏱ {display}
    </span>
  )
}
