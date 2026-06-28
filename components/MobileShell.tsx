import { BottomNav } from './BottomNav'

export function MobileShell({
  children,
  showNav = true,
  bgClassName = 'bg-[#0d0d0f]',
  maxWidthClass = 'max-w-[480px]',
}: {
  children: React.ReactNode
  showNav?: boolean
  bgClassName?: string
  /** Override content width — e.g. admin uses wider layout on laptop */
  maxWidthClass?: string
}) {
  return (
    <div dir="rtl" className={`min-h-screen overflow-x-hidden ${bgClassName}`}>
      <div className={`mx-auto w-full ${maxWidthClass} px-4 pt-4 ${showNav ? 'pb-20' : 'pb-6'}`}>
        {children}
      </div>
      {showNav && <BottomNav />}
    </div>
  )
}
