const env = {
  appName: import.meta.env.VITE_APP_NAME || '增強智卷 EmpowerPaper',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001/api',
  // Cloud Run 冷啟動 + 同步清理可能超過 30 秒，預設放寬到 120 秒
  apiTimeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS || 120000),
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
