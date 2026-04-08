export default function ScanFrame({ children }) {
  return (
    <div className="relative overflow-hidden rounded-[28px] border border-cyan-200/20 bg-slate-950/40 p-3">
      <div className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />
      <div className="pointer-events-none absolute inset-y-4 left-0 w-px bg-gradient-to-b from-transparent via-cyan-200/50 to-transparent" />
      {children}
    </div>
  )
}
