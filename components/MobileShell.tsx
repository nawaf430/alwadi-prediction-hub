import { BottomNav } from './BottomNav'

export function MobileShell({
  children,
  showNav = true,
  bgClassName = 'bg-[#0d0d0f]',
}: {
  children: React.ReactNode
  showNav?: boolean
  bgClassName?: string
}) {
  return (
    <div dir="rtl" className={`min-h-screen overflow-x-hidden ${bgClassName}`}>
      <div className={`mx-auto w-full max-w-[380px] px-4 pt-4 ${showNav ? 'pb-20' : 'pb-6'}`}>
        {children}
      </div>
      {showNav && <BottomNav />}
    </div>
  )
}
