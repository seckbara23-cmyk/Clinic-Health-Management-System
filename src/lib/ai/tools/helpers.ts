// Small helpers shared by AI tools. Pure; no Supabase client imported here.

/** Most recent ISO date (YYYY-MM-DD) from a list of rows with created_at. */
export function latestDate(rows: Array<{ created_at?: string | null }>): string | undefined {
  const dates = rows
    .map((r) => r.created_at)
    .filter((d): d is string => typeof d === 'string')
    .sort()
  const last = dates[dates.length - 1]
  return last ? last.slice(0, 10) : undefined
}
