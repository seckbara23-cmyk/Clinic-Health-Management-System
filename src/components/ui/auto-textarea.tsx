'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface AutoTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum height in px (defaults to ~2 rows). */
  minHeight?: number
  /**
   * Extra value to watch for re-measuring. Pass the current field value when
   * using react-hook-form's uncontrolled `register()` so the textarea grows once
   * async data (e.g. a loaded consultation) populates it via the DOM ref.
   */
  resizeDep?: unknown
}

/**
 * A textarea that grows with its content instead of scrolling. Works with
 * react-hook-form's `register()` — pass the registered ref/onChange through and
 * this component merges its own ref so it can measure `scrollHeight`. Resizes on
 * input, on programmatic value changes, and on mount.
 */
const AutoTextarea = React.forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  ({ className, minHeight = 60, onChange, value, resizeDep, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

    const setRef = React.useCallback((node: HTMLTextAreaElement | null) => {
      innerRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
    }, [forwardedRef])

    const resize = React.useCallback(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
    }, [minHeight])

    // Re-measure whenever the controlled value or the defaultValue-backed DOM
    // content changes (covers react-hook-form `values`/`reset` re-populating).
    React.useEffect(() => { resize() }, [resize, value, resizeDep, props.defaultValue])

    return (
      <textarea
        ref={setRef}
        value={value}
        onChange={e => { onChange?.(e); resize() }}
        onInput={resize}
        rows={2}
        className={cn(
          'flex w-full resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        style={{ minHeight }}
        {...props}
      />
    )
  },
)
AutoTextarea.displayName = 'AutoTextarea'

export { AutoTextarea }
