export default function Spinner({ label = '處理中…' }) {
  return (
    <div className="inline-flex items-center gap-3 text-sm text-slate-200">
      <span className="relative inline-flex h-6 w-6">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300/45" />
        <span className="relative inline-flex h-6 w-6 rounded-full border border-cyan-200/60 bg-cyan-300/15" />
      </span>
      <span>{label}</span>
    </div>
  )
}
