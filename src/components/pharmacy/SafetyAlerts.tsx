'use client'

import { AlertTriangle, AlertOctagon, Info, Repeat } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import type { SafetySeverity, SafetyWarning, Substitution } from '@/lib/medication-safety'

// Color coding per the safety spec: critical = red, warning = amber, info = blue.
const SEVERITY_STYLES: Record<SafetySeverity, { box: string; icon: string; Icon: React.ElementType }> = {
  critical: { box: 'border-red-200 bg-red-50 text-red-800',     icon: 'text-red-600',   Icon: AlertOctagon },
  warning:  { box: 'border-amber-200 bg-amber-50 text-amber-800', icon: 'text-amber-600', Icon: AlertTriangle },
  info:     { box: 'border-blue-200 bg-blue-50 text-blue-800',   icon: 'text-blue-600',  Icon: Info },
}

/**
 * Read-only, color-coded medication-safety warnings + optional substitution
 * suggestions. Warnings only — this component never blocks a workflow. When
 * `onPickSubstitution` is supplied, in-stock alternatives get a one-click swap.
 */
export function SafetyAlerts({
  warnings,
  substitutions,
  onPickSubstitution,
  className,
}: {
  warnings: SafetyWarning[]
  substitutions?: Substitution[]
  onPickSubstitution?: (s: Substitution) => void
  className?: string
}) {
  const t = useTranslations('medicationSafety')
  if (warnings.length === 0 && (!substitutions || substitutions.length === 0)) return null

  return (
    <div className={cn('space-y-2', className)} role="status" aria-live="polite">
      {warnings.map((w, i) => {
        const s = SEVERITY_STYLES[w.severity]
        return (
          <div key={`${w.code}-${w.medication}-${i}`} className={cn('flex items-start gap-2.5 rounded-lg border px-3 py-2.5', s.box)}>
            <s.Icon className={cn('mt-0.5 h-4 w-4 shrink-0', s.icon)} />
            <p className="text-sm leading-snug">
              {t(`msg_${w.code}`, { medication: w.medication, ...(w.params ?? {}) })}
            </p>
          </div>
        )
      })}

      {substitutions && substitutions.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
            <Repeat className="h-4 w-4 text-blue-600" />
            {t('substitutionTitle')}
          </div>
          <p className="mt-0.5 text-xs text-blue-600">{t('substitutionHelp')}</p>
          <ul className="mt-2 space-y-1.5">
            {substitutions.map(sub => (
              <li key={sub.id} className="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2.5 py-1.5">
                <span className="min-w-0 truncate text-sm text-gray-800">{sub.name}</span>
                <div className="flex shrink-0 items-center gap-2">
                  {sub.inStock
                    ? <Badge variant="secondary" className="text-emerald-700">{t('inStockN', { n: sub.stock })}</Badge>
                    : <Badge variant="outline" className="text-gray-500">{t('outOfStock')}</Badge>}
                  {onPickSubstitution && sub.inStock && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => onPickSubstitution(sub)}>
                      {t('useAlternative')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
