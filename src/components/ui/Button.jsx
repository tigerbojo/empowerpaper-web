import clsx from 'clsx'

const variants = {
  primary: 'bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-950 shadow-glow hover:brightness-110',
  secondary: 'border border-line bg-white/10 text-white hover:bg-white/15',
  ghost: 'bg-transparent text-slate-200 hover:bg-white/10',
  danger: 'bg-rose-500/90 text-white hover:bg-rose-400',
}

export default function Button({ children, className, variant = 'primary', size = 'md', ...props }) {
  const sizes = {
    sm: 'h-10 px-4 text-sm',
    md: 'h-11 px-5 text-sm',
    lg: 'h-12 px-6 text-base',
  }

  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center rounded-full font-medium transition duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
