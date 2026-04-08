import { useEffect } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import useAuthStore, { guestUser } from '@/store/useAuthStore'
import { firebaseAuth, isFirebaseReady, signInWithGoogle } from '@/services/firebase'

export function useAuth() {
  const user = useAuthStore((state) => state.user)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const authProvider = useAuthStore((state) => state.authProvider)
  const setAuthState = useAuthStore((state) => state.setAuthState)
  const logoutStore = useAuthStore((state) => state.logout)

  useEffect(() => {
    if (!isFirebaseReady || !firebaseAuth) {
      setAuthState({ user: guestUser, isAuthenticated: false, authProvider: 'guest' })
      return undefined
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
      if (!firebaseUser) {
        setAuthState({ user: guestUser, isAuthenticated: false, authProvider: 'firebase' })
        return
      }

      setAuthState({
        user: {
          id: firebaseUser.uid,
          name: firebaseUser.displayName || firebaseUser.email || 'Firebase 使用者',
          role: 'teacher',
          email: firebaseUser.email || '',
        },
        isAuthenticated: true,
        authProvider: 'firebase',
      })
    })

    return unsubscribe
  }, [setAuthState])

  const loginWithGoogle = async () => {
    if (!isFirebaseReady) {
      throw new Error('尚未設定 Firebase，暫時只能使用訪客模式')
    }
    return signInWithGoogle()
  }

  const logout = async () => {
    if (isFirebaseReady && firebaseAuth) {
      await signOut(firebaseAuth)
    }
    logoutStore()
  }

  return { user, isAuthenticated, authProvider, logout, loginWithGoogle, isFirebaseReady }
}
