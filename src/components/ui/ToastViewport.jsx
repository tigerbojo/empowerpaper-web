import clsx from 'clsx'
import useUiStore from '@/store/useUiStore'

const toneStyles = {
  info: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-50',
  success: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-50',
  warning: 'border-amber-300/20 bg-amber-300/10 text-amber-50',
  error: 'border-rose-300/20 bg-rose-300/10 text-rose-50',
}

export default function ToastViewport() {
  const toasts = useUiStore((state) => state.toasts)
  const dismissToast = useUiStore((state) => state.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={clsx(
            'pointer-events-auto rounded-[24px] border px-4 py-4 shadow-2xl backdrop-blur-xl',
            toneStyles[toast.tone] || toneStyles.info,
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-medium">{toast.title}</div>
              {toast.description && <div className="mt-1 text-sm opacity-90">{toast.description}</div>}
            </div>
            <button
              type="button"
              className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
              onClick={() => dismissToast(toast.id)}
            >
              關閉
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
