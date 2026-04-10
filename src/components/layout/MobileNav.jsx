import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

const items = [
  { to: '/', label: '儀表板', icon: '📊' },
  { to: '/upload', label: '上傳', icon: '📤' },
  { to: '/edit', label: '框選', icon: '✂️' },
  { to: '/generate', label: '組卷', icon: '📄' },
]

export default function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden border-t border-line bg-slate-950/85 backdrop-blur-xl">
      <div className="flex items-center justify-around px-2 py-2 safe-area-inset-bottom">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => clsx(
              'flex flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[11px] transition min-w-[60px]',
              isActive
                ? 'bg-cyan-300/15 text-cyan-200'
                : 'text-slate-400 hover:text-slate-200',
            )}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
