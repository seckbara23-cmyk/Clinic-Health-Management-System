import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

// Rate limiting via Upstash Redis (persistent across Vercel serverless invocations).
//
// FAIL-OPEN DESIGN: if UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not
// set, or if Redis is unreachable, requests are allowed through. The app stays
// functional in development and during Upstash outages. Set these env vars in
// production to activate enforcement.

export type RateLimitEndpoint =
  | 'clinic-requests'
  | 'signup'
  | 'change-password'
  | 'ai-chat'
  | 'ai-insights'
  | 'reliability-report'

// Per-endpoint limits (requests per sliding 1-hour window).
// Override the request count via env vars if needed.
const LIMITS: Record<RateLimitEndpoint, { requests: number }> = {
  'clinic-requests': { requests: Number(process.env.RATE_LIMIT_CLINIC_REQUESTS  ?? '5')   },
  'signup':          { requests: Number(process.env.RATE_LIMIT_SIGNUP           ?? '10')  },
  'change-password': { requests: Number(process.env.RATE_LIMIT_CHANGE_PASSWORD  ?? '10')  },
  'ai-chat':         { requests: Number(process.env.RATE_LIMIT_AI_CHAT          ?? '60')  },
  // Insights fire on page load, so the ceiling is higher than chat.
  'ai-insights':     { requests: Number(process.env.RATE_LIMIT_AI_INSIGHTS      ?? '240') },
  // Client error reports can burst during an incident — allow a generous ceiling
  // (the client also de-dupes within a session before posting).
  'reliability-report': { requests: Number(process.env.RATE_LIMIT_RELIABILITY ?? '120') },
}

function getClientIp(req: NextRequest): string {
  // Vercel forwards the real client IP in x-forwarded-for.
  // Take only the first address to prevent spoofing via appended IPs.
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

/**
 * Apply sliding-window rate limiting for the given endpoint.
 *
 * Returns a 429 NextResponse when the limit is exceeded.
 * Returns null to allow the request through (including when Upstash is not configured).
 */
export async function rateLimit(
  req: NextRequest,
  endpoint: RateLimitEndpoint,
): Promise<NextResponse | null> {
  const redisUrl   = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!redisUrl || !redisToken) {
    // Not configured — fail open. Log once so ops knows enforcement is inactive.
    console.warn(`[rate-limit] Upstash not configured — rate limiting inactive for "${endpoint}"`)
    return null
  }

  try {
    // Dynamic import keeps the bundle lean when Upstash is not configured.
    const { Ratelimit } = await import('@upstash/ratelimit')
    const { Redis }     = await import('@upstash/redis')

    const limiter = new Ratelimit({
      redis:     new Redis({ url: redisUrl, token: redisToken }),
      limiter:   Ratelimit.slidingWindow(LIMITS[endpoint].requests, '1 h'),
      prefix:    'chms:rl',
      analytics: false,
    })

    const ip = getClientIp(req)
    const { success, remaining, reset } = await limiter.limit(`${endpoint}:${ip}`)

    if (success) return null

    return NextResponse.json(
      { error: 'Trop de requêtes. Réessayez plus tard.' },
      {
        status: 429,
        headers: {
          'Retry-After':           String(Math.ceil((reset - Date.now()) / 1000)),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset':     String(reset),
        },
      },
    )
  } catch (err) {
    // Redis error (timeout, network issue, etc.) — fail open so the app keeps working.
    console.warn('[rate-limit] Redis check failed, allowing request:', (err as Error).message)
    return null
  }
}
