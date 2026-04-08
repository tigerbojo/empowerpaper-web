import clsx from 'clsx'

const toneStyles = {
  info: 'border-cyan-300/15 bg-cyan-300/8 text-cyan-100',
  success: 'border-emerald-300/15 bg-emerald-300/8 text-emerald-100',
  warning: 'border-amber-300/15 bg-amber-300/8 text-amber-100',
  error: 'border-rose-300/15 bg-rose-300/8 text-rose-100',
}

export default function NoticeBanner({ title, description, tone = 'info', className, actions }) {
  return (
    <div className={clsx('rounded-[22px] border px-4 py-4', toneStyles[tone] || toneStyles.info, className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium">{title}</div>
          {description && <div className="mt-1 text-sm opacity-90">{description}</div>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
