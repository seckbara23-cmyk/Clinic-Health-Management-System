'use client'

import { useQuery } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { AI_UI_ENABLED, parsePageContext } from '@/lib/ai/ui'
import type { AIToolResult, StructuredAIResponse } from '@/lib/ai/types'

export interface InsightsResponse {
  results: AIToolResult[]
  response: StructuredAIResponse
  meta: { toolsUsed: string[]; dataCategories: string[]; provider: string }
}

// Fetches embedded insights for the current page. Disabled (no network) when
// the AI UI flag is off. Role/clinic are resolved server-side; we only send the
// page/entity context derived from the route.
export function useInsights(categories?: string[]) {
  const pathname = usePathname()
  const ctx = parsePageContext(pathname)
  return useQuery<InsightsResponse>({
    queryKey: ['ai-insights', pathname, categories?.join(',') ?? 'all'],
    enabled: AI_UI_ENABLED,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...ctx, categories }),
      })
      if (!res.ok) throw new Error(`insights ${res.status}`)
      return (await res.json()) as InsightsResponse
    },
  })
}
