const env = {
  appName: import.meta.env.VITE_APP_NAME || '考卷新生 Web 預覽版',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api',
  apiTimeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS || 30000),
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  },
  google: {
    region: import.meta.env.VITE_GCP_REGION || 'asia-east1',
    gcsBucket: import.meta.env.VITE_GCS_BUCKET || '',
    visionProvider: import.meta.env.VITE_VISION_PROVIDER || 'google-cloud-vision',
    backendPlatform: import.meta.env.VITE_BACKEND_PLATFORM || 'cloud-run',
  },
}

export function hasFirebaseConfig() {
  return Object.values(env.firebase).every(Boolean)
}

export default env
