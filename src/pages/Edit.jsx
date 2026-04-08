import CropWorkspace from '@/features/cropping/components/CropWorkspace'
import GlassCard from '@/components/ui/GlassCard'
import NoticeBanner from '@/components/ui/NoticeBanner'
import Button from '@/components/ui/Button'
import { useNavigate } from 'react-router-dom'
import usePaperStore from '@/store/usePaperStore'

export default function Edit() {
  const navigate = useNavigate()
  const cleanedImage = usePaperStore((state) => state.cleanedImage)
  const currentPaperId = usePaperStore((state) => state.currentPaperId)
  const crops = usePaperStore((state) => state.crops)

  return (
    <div className="space-y-5">
      <GlassCard title="錯題框選與 AI 標籤" description="先手動框選錯題區塊，之後會將裁切影像送往 OCR 與 AI 做分類、標籤與題庫整理。" />

      {!cleanedImage && (
        <NoticeBanner
          tone="warning"
          title="尚未取得乾淨圖檔"
          description="請先到上傳頁完成預處理，這裡才會出現可裁切的工作區。"
          actions={<Button size="sm" onClick={() => navigate('/upload')}>前往上傳頁</Button>}
        />
      )}

      {cleanedImage && (
        <NoticeBanner
          tone={currentPaperId ? 'success' : 'info'}
          title={currentPaperId ? '已連結後端 paper id' : '目前仍在本地模式'}
          description={
            currentPaperId
              ? `目前 paper id：${currentPaperId}，新增裁切時會優先送往後端取得標籤。`
              : `已建立 ${crops.length} 題裁切資料，但後端尚未正式回傳 paper id。`
          }
          actions={crops.length > 0 ? <Button size="sm" onClick={() => navigate('/generate')}>前往組卷頁</Button> : null}
        />
      )}

      <CropWorkspace />
    </div>
  )
}
