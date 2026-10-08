import type { MouseEvent, ReactNode } from 'react'
import { viewUrl, type View } from '../lib/views'

export default function ViewLink({
  view,
  onNavigate,
  children,
  className,
  current = false,
}: {
  view: View
  onNavigate: (view: View) => void
  children: ReactNode
  className?: string
  current?: boolean
}) {
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    event.preventDefault()
    onNavigate(view)
  }

  return (
    <a
      href={viewUrl(view)}
      className={className}
      aria-current={current ? 'page' : undefined}
      onClick={navigate}
    >
      {children}
    </a>
  )
}
