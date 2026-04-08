import { isFirebaseReady } from '@/services/firebase'

export const authFeature = {
  enabled: true,
  provider: isFirebaseReady ? 'firebase-auth' : 'guest-fallback',
}
