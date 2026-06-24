'use client'

import { usePathname, useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard', icon: '🏠', label: 'التوقعات' },
  { href: '/leaderboard', icon: '🏆', label: 'الترتيب' },
]

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-[#111115] border-t border-[#1f1f24]">
      <div className="mx-auto flex max-w-[480px]">
        {NAV.map(({ href, icon, label }) => {
          const active = pathname === href
          return (
            <button
              key={href}
              onClick={() => router.push(href)}
              onMouseEnter={() => router.prefetch(href)}
              onTouchStart={() => router.prefetch(href)}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-3 min-h-[56px] transition-colors ${
                active ? 'text-[#16a34a]' : 'text-[#6b7280]'
              }`}
            >
              <span className="text-xl leading-none">{icon}</span>
              <span className="text-[11px] font-medium">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
