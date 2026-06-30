'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Sparkles, X, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useClinic } from '@/context/ClinicContext'
import { useCopilot } from '@/hooks/useCopilot'
import { skillForRole } from '@/lib/ai/skills'
import { AI_UI_ENABLED, parsePageContext } from '@/lib/ai/ui'
import { StructuredResponse } from './StructuredResponse'
import type { Role } from '@/types/database'
import type { StructuredAIResponse } from '@/lib/ai/types'

interface Turn {
  id: number
  role: 'user' | 'assistant'
  text?: string
  data?: StructuredAIResponse
}

// Floating, page-aware read-only Copilot. Page-first: opens to role/page
// suggestions before the user types. Renders structured responses with sources
// and a confidence badge. Inert unless NEXT_PUBLIC_AI_ENABLED (server also
// enforces AI_ENABLED).
export function Copilot() {
  const t = useTranslations('copilot')
  const pathname = usePathname()
  const { profile } = useClinic()
  const ask = useCopilot()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [nextId, setNextId] = useState(1)

  if (!AI_UI_ENABLED) return null

  const role = (profile?.role ?? undefined) as Role | undefined
  const skill = role ? skillForRole(role) : undefined
  const suggestions = skill?.suggestedPrompts ?? []

  const labelFor = (id: string, fallback: string) =>
    t.has(`suggestions.${id}`) ? t(`suggestions.${id}`) : fallback

  function submit(message: string) {
    const msg = message.trim()
    if (!msg || ask.isPending) return
    const userId = nextId
    setTurns((prev) => [...prev, { id: userId, role: 'user', text: msg }])
    setNextId((n) => n + 1)
    setInput('')
    ask.mutate(
      { message: msg, context: parsePageContext(pathname) },
      {
        onSuccess: (res) => {
          setTurns((prev) => [...prev, { id: userId + 1000000, role: 'assistant', data: res.response }])
        },
        onError: () => {
          setTurns((prev) => [
            ...prev,
            {
              id: userId + 1000000,
              role: 'assistant',
              data: {
                summary: t('error'),
                warnings: [],
                suggestions: [],
                actions: [],
                citations: [],
                confidence: { level: 'low', basedOn: [] },
              },
            },
          ])
        },
      },
    )
    setNextId((n) => n + 1)
  }

  return (
    <>
      {/* Floating launcher (left side to avoid the FAB on the right) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('open')}
          className="fixed bottom-20 left-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 md:bottom-6"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
          {/* Drawer */}
          <aside className="flex h-full w-full max-w-md flex-col border-l bg-background shadow-xl sm:w-[420px]">
            <header className="flex items-start justify-between border-b p-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">{t('title')}</h2>
                </div>
                <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label={t('close')}>
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {turns.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t('empty')}</p>
                  {suggestions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">{t('suggestionsTitle')}</p>
                      <div className="flex flex-wrap gap-2">
                        {suggestions.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => submit(s.prompt ?? s.label)}
                            className="rounded-full border px-3 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
                          >
                            {labelFor(s.id, s.label)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {turns.map((turn) =>
                turn.role === 'user' ? (
                  <div key={turn.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {turn.text}
                  </div>
                ) : (
                  <div key={turn.id} className="max-w-[95%] rounded-lg border bg-card p-3">
                    {turn.data && <StructuredResponse data={turn.data} />}
                  </div>
                ),
              )}

              {ask.isPending && <p className="text-xs text-muted-foreground">{t('thinking')}</p>}
            </div>

            <footer className="border-t p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  submit(input)
                }}
                className="flex items-end gap-2"
              >
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submit(input)
                    }
                  }}
                  placeholder={t('placeholder')}
                  rows={2}
                  className="min-h-[44px] resize-none text-sm"
                />
                <Button type="submit" size="icon" disabled={ask.isPending || !input.trim()} aria-label={t('send')}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-2 text-[11px] leading-tight text-muted-foreground">{t('disclaimer')}</p>
            </footer>
          </aside>
        </div>
      )}
    </>
  )
}
