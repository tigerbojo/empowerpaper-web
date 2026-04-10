import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import GlassCard from '@/components/ui/GlassCard'
import Button from '@/components/ui/Button'
import NoticeBanner from '@/components/ui/NoticeBanner'
import apiClient from '@/services/apiClient'
import usePaperStore from '@/store/usePaperStore'

function formatDate(iso) {
  if (!iso) return '-'
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function History() {
  const navigate = useNavigate()
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const setCurrentPaperId = usePaperStore((state) => state.setCurrentPaperId)
  const setOriginalImage = usePaperStore((state) => state.setOriginalImage)
  const setCleanedImage = usePaperStore((state) => state.setCleanedImage)
  const setSelectedEditImage = usePaperStore((state) => state.setSelectedEditImage)

  useEffect(() => {
    setLoading(true)
    apiClient
      .get('/papers/history')
      .then(({ data }) => {
        setPapers(data?.papers || [])
        setError(null)
      })
      .catch((err) => {
        setError(err.message || '無法載入歷史記錄')
      })
      .finally(() => setLoading(false))
  }, [])

  const handleResume = (paper) => {
    setCurrentPaperId(paper.paper_id)
    setOriginalImage(paper.original_url)
    if (paper.cleaned_url) {
      setCleanedImage(paper.cleaned_url)
      setSelectedEditImage(paper.cleaned_url, 'cleaned')
    } else {
      setSelectedEditImage(paper.original_url, 'original')
    }
    navigate('/edit')
  }

  return (
    <div className="space-y-5">
      <GlassCard
        title="歷史記錄"
        description="查看你之前上傳並處理過的考卷，可以直接進入框選頁繼續編輯。"
      />

      {loading && (
        <NoticeBanner title="載入中…" description="正在從 Supabase 取得歷史記錄。" />
      )}

      {error && (
        <NoticeBanner tone="warning" title="無法載入" description={error} />
      )}

      {!loading && !error && papers.length === 0 && (
        <NoticeBanner
          title="目前沒有歷史記錄"
          description="先到上傳頁處理一張考卷，這裡就會顯示。"
          actions={<Button size="sm" onClick={() => navigate('/upload')}>前往上傳頁</Button>}
        />
      )}

      {!loading && papers.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {papers.map((paper) => (
            <GlassCard key={paper.paper_id}>
              <div className="space-y-3">
                <div className="aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-white">
                  {paper.cleaned_url ? (
                    <img src={paper.cleaned_url} alt={paper.paper_id} className="h-full w-full object-contain" />
                  ) : paper.original_url ? (
                    <img src={paper.original_url} alt={paper.paper_id} className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">無預覽</div>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  <div className="truncate font-mono text-cyan-200">{paper.paper_id}</div>
                  <div className="mt-1">{formatDate(paper.created_at)}</div>
                </div>
                <Button size="sm" className="w-full" onClick={() => handleResume(paper)}>
                  繼續編輯
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}
