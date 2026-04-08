import { create } from 'zustand'

const guestUser = { id: 'guest-user', name: '訪客老師', role: 'guest' }

const useAuthStore = create((set) => ({
  user: guestUser,
  isAuthenticated: false,
  authProvider: 'guest',
  setAuthState: ({ user, isAuthenticated, authProvider = 'guest' }) => set({ user, isAuthenticated, authProvider }),
  login: (user, authProvider = 'custom') => set({ user, isAuthenticated: true, authProvider }),
  logout: () => set({ user: guestUser, isAuthenticated: false, authProvider: 'guest' }),
}))

export { guestUser }
export default useAuthStore
