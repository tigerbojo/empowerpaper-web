import GlassCard from '@/components/ui/GlassCard'
import Button from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import useUiStore from '@/store/useUiStore'

export default function AuthStatusCard() {
  const { user, isAuthenticated, authProvider, loginWithGoogle, logout, isFirebaseReady } = useAuth()
  const pushToast = useUiStore((state) => state.pushToast)

  const handleLogin = async () => {
    try {
      await loginWithGoogle()
      pushToast({
        tone: 'success',
        title: '登入成功',
        description: '已透過 Google / Firebase 完成登入。',
      })
    } catch (error) {
      pushToast({
        tone: 'warning',
        title: '目前仍使用訪客模式',
        description: error.message,
      })
    }
  }

  const handleLogout = async () => {
    await logout()
    pushToast({
      tone: 'info',
      title: '已登出',
      description: '目前已切回訪客模式。',
    })
  }

  return (
    <GlassCard
      title="登入狀態"
      description="這裡會顯示目前是否已接上 Firebase Authentication，也方便你之後快速切換到正式登入流程。"
      actions={isAuthenticated ? (
        <Button variant="secondary" onClick={handleLogout}>登出</Button>
      ) : (
        <Button onClick={handleLogin} disabled={!isFirebaseReady}>Google 登入</Button>
      )}
    >
      <div className="space-y-3 text-sm text-slate-300">
        <div>目前身分：<span className="font-medium text-white">{user?.name || '未登入'}</span></div>
        <div>驗證來源：<span className="font-medium text-white">{authProvider}</span></div>
        <div>Firebase 狀態：<span className="font-medium text-white">{isFirebaseReady ? '已設定' : '尚未設定'}</span></div>
      </div>

      {!isFirebaseReady && (
        <div className="mt-4 rounded-[20px] border border-amber-300/15 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
          尚未填入 Firebase Web SDK 憑證，目前會以訪客模式運作。
        </div>
      )}
    </GlassCard>
  )
}
