import { Outlet } from 'react-router-dom'
import Header from './components/layout/Header'
import Sidebar from './components/layout/Sidebar'
import MobileNav from './components/layout/MobileNav'
import ToastViewport from '@/components/ui/ToastViewport'
import { useAuth } from '@/hooks/useAuth'

export default function App() {
  useAuth()

  return (
    <div className="min-h-screen bg-ink text-mist bg-halo">
      <ToastViewport />
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] gap-5 px-3 py-4 sm:px-4 lg:px-6 pb-24 lg:pb-4">
        <Sidebar />
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <Header />
          <main className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-line bg-white/5 p-3 shadow-glass backdrop-blur-xl sm:rounded-4xl sm:p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileNav />
    </div>
  )
}
