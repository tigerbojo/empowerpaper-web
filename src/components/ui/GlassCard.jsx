import clsx from 'clsx'

export default function GlassCard({ title, description, className, actions, children }) {
  return (
    <section className={clsx('glass-panel p-5 lg:p-6', className)}>
      {(title || description || actions) && (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-lg font-semibold text-white">{title}</h3>}
            {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
