import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { SMS_ENABLED } from '@/lib/sms/config'
import { enqueueDueReminders } from '@/lib/sms/enqueue'
import { dispatchQueued } from '@/lib/sms/process'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET /api/cron/sms
// Invoked by Vercel Cron every 15 minutes (see vercel.json). One tick:
//   1. enqueue reminders for appointments entering the 24h / 3h windows
//   2. dispatch a batch of due queued messages
// Authenticated with CRON_SECRET (Vercel sends it as a Bearer token). Fails
// closed: if CRON_SECRET is unset, every request is rejected.
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!SMS_ENABLED) {
    return NextResponse.json({ ok: true, skipped: 'sms_disabled' })
  }

  const service = createServiceClient()
  const now = new Date()

  try {
    const enqueue = await enqueueDueReminders(service, now)
    const dispatch = await dispatchQueued(service, now, 50)
    return NextResponse.json({ ok: true, now: now.toISOString(), enqueue, dispatch })
  } catch (err) {
    console.error('[cron/sms] run failed', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Run failed' },
      { status: 500 },
    )
  }
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false  // fail closed
  const header = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
