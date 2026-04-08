import { create } from 'zustand'

const AUTO_DISMISS_MS = 3600

const useUiStore = create((set) => ({
  toasts: [],
  pushToast: ({ title, description = '', tone = 'info', duration = AUTO_DISMISS_MS }) => {
    const id = crypto.randomUUID()
    set((state) => ({
      toasts: [...state.toasts, { id, title, description, tone }],
    }))

    if (duration > 0) {
      window.setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
      }, duration)
    }

    return id
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}))

export default useUiStore
