'use client'

// ── Settings › Enterprise Authorization (Phase 40) ─────────────────
//
// READ-ONLY reference view of the Enterprise Authorization framework: which roles
// may open which modules, which roles may read which sensitive fields, and which
// AI data domains each role inherits. Every cell is computed from the SAME pure
// engine the app enforces with (lib/authz), so this page can never drift from
// reality. Editing custom roles / break-glass is future work — this surfaces the
// model. Gated to admin/super_admin by the /admin layout.

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { ShieldCheck, Lock, Sparkles, Info, KeyRound, Layers } from 'lucide-react'
import { Topbar } from '@/components/layout/Topbar'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { ROLES } from '@/lib/authz/matrix'
import {
  buildModuleMatrix, buildFieldMatrix, buildAiMatrix, permissionCounts, type MatrixRow,
} from '@/lib/authz/view'

export default function AuthorizationPage() {
  const t = useTranslations('authz')

  const moduleRows = useMemo(() => buildModuleMatrix(), [])
  const fieldRows = useMemo(() => buildFieldMatrix(), [])
  const aiRows = useMemo(() => buildAiMatrix(), [])
  const counts = useMemo(() => permissionCounts(), [])

  return (
    <div className="flex flex-col h-full">
      <Topbar title={t('title')} description={t('subtitle')} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
        {/* Guarantee banner — RLS is the boundary; this is a least-privilege layer */}
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span>{t('rlsNotice')}</span>
        </div>

        {/* Per-role permission summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {ROLES.map(r => (
            <div key={r} className="rounded-xl bg-gray-50 p-3">
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-500">{t(`role_${r}`)}</p>
              <p className="mt-1 text-lg font-bold text-teal-700">{counts[r] ?? 0}</p>
              <p className="text-[10px] text-gray-400">{t('permsLabel')}</p>
            </div>
          ))}
        </div>

        {/* Module access matrix */}
        <MatrixCard
          icon={Layers}
          title={t('moduleMatrixTitle')}
          note={t('moduleMatrixNote')}
          rows={moduleRows}
          rowLabel={key => t(`mod_${key}`)}
          t={t}
        />

        {/* Field-level security matrix */}
        <MatrixCard
          icon={Lock}
          title={t('fieldMatrixTitle')}
          note={t('fieldMatrixNote')}
          rows={fieldRows}
          rowLabel={key => t(`field_${key}`)}
          t={t}
          accent="amber"
        />

        {/* AI inheritance matrix */}
        <MatrixCard
          icon={Sparkles}
          title={t('aiMatrixTitle')}
          note={t('aiMatrixNote')}
          rows={aiRows}
          rowLabel={key => t(`ai_${key}`)}
          t={t}
          accent="violet"
        />

        {/* Future-ready notes: break-glass + custom roles */}
        <div className="grid gap-4 md:grid-cols-2">
          <FutureCard icon={KeyRound} title={t('breakGlassTitle')} body={t('breakGlassBody')} />
          <FutureCard icon={Info} title={t('customRolesTitle')} body={t('customRolesBody')} />
        </div>
      </div>
    </div>
  )
}

function MatrixCard({
  icon: Icon, title, note, rows, rowLabel, t, accent = 'teal',
}: {
  icon: React.ElementType
  title: string
  note: string
  rows: MatrixRow[]
  rowLabel: (key: string) => string
  t: (k: string) => string
  accent?: 'teal' | 'amber' | 'violet'
}) {
  const dot = accent === 'amber' ? 'text-amber-600' : accent === 'violet' ? 'text-violet-600' : 'text-teal-700'
  return (
    <Card>
      <CardContent className="p-4 md:p-5">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Icon className={cn('h-4 w-4', dot)} /> {title}
        </p>
        <p className="mb-3 text-[11px] leading-tight text-muted-foreground/70">{note}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-3 text-left font-medium text-gray-500">{t('colResource')}</th>
                {ROLES.map(r => (
                  <th key={r} className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    {t(`role_${r}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 font-medium text-gray-800">{rowLabel(row.key)}</td>
                  {ROLES.map(r => (
                    <td key={r} className="px-2 py-2 text-center">
                      {row.cells[r] ? (
                        <span className={cn('inline-block h-2.5 w-2.5 rounded-full', accent === 'amber' ? 'bg-amber-500' : accent === 'violet' ? 'bg-violet-500' : 'bg-teal-500')} />
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function FutureCard({ icon: Icon, title, body }: { icon: React.ElementType; title: string; body: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <Icon className="h-4 w-4 text-gray-500" /> {title}
        </p>
        <p className="text-xs leading-relaxed text-gray-500">{body}</p>
      </CardContent>
    </Card>
  )
}
