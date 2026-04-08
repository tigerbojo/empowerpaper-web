import { Outlet } from 'react-router-dom'
import Header from './components/layout/Header'
import Sidebar from './components/layout/Sidebar'
import ToastViewport from '@/components/ui/ToastViewport'
import { useAuth } from '@/hooks/useAuth'

export default function App() {
  useAuth()

  return (
    <div className="min-h-screen bg-ink text-mist bg-halo">
      <ToastViewport />
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] gap-5 px-4 py-4 lg:px-6">
        <Sidebar />
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <Header />
          <main className="min-h-0 flex-1 overflow-hidden rounded-4xl border border-line bg-white/5 p-4 shadow-glass backdrop-blur-xl lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
