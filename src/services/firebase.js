import { initializeApp, getApps, getApp } from 'firebase/app'
import { GoogleAuthProvider, getAuth, signInWithPopup } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import env, { hasFirebaseConfig } from '@/config/env'

let firebaseApp = null
let firebaseAuth = null
let firebaseStorage = null
let googleProvider = null

if (hasFirebaseConfig()) {
  firebaseApp = getApps().length ? getApp() : initializeApp(env.firebase)
  firebaseAuth = getAuth(firebaseApp)
  firebaseStorage = getStorage(firebaseApp)
  googleProvider = new GoogleAuthProvider()
}

export async function signInWithGoogle() {
  if (!firebaseAuth || !googleProvider) {
    throw new Error('尚未設定 Firebase Auth')
  }

  return signInWithPopup(firebaseAuth, googleProvider)
}

export { firebaseApp, firebaseAuth, firebaseStorage, googleProvider }
export const isFirebaseReady = Boolean(firebaseApp)
