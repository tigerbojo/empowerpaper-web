import { useLocation } from 'react-router-dom'
import useAuthStore from '@/store/useAuthStore'
import env from '@/config/env'

const titles = {
  '/': {
    title: '增強智卷儀表板',
    subtitle: '掌握目前上傳、裁切、標籤與組卷進度，作為 EmpowerPaper 的工作中樞。',
  },
  '/upload': {
    title: '上傳與預處理',
    subtitle: '先在前端做圖片壓縮，再交給 FastAPI 與 OpenCV 進行去筆跡、拉平與後續分析。',
  },
  '/edit': {
    title: '錯題框選與標籤',
    subtitle: '用 react-cropper 進行人工微調，後續會串接 OCR 與 AI 標籤建議。',
  },
  '/generate': {
    title: '智慧組卷與匯出',
    subtitle: '整理已挑選的題目，產生 A4 預覽與 PDF，之後可接 Cloud Storage 與分享流程。',
  },
  '/history': {
    title: '歷史記錄',
    subtitle: '查看之前處理過的考卷，可以直接點開繼續編輯。',
  },
}

export default function Header() {
  const location = useLocation()
  const user = useAuthStore((state) => state.user)
  const current = titles[location.pathname] ?? titles['/']

  return (
    <header className="glass-panel flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:p-6">
      <div>
        <p className="mb-1 text-[10px] uppercase tracking-[0.24em] text-cyan-200/80 lg:mb-2 lg:text-xs">{env.appName}</p>
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl lg:text-3xl">{current.title}</h1>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-300 lg:mt-2 lg:text-sm lg:leading-6">{current.subtitle}</p>
      </div>
      <div className="hidden rounded-full border border-line bg-white/10 px-4 py-2 text-sm text-slate-200 lg:block">
        {user ? `歡迎回來，${user.name}` : '尚未登入，將以訪客模式操作'}
      </div>
    </header>
  )
}
