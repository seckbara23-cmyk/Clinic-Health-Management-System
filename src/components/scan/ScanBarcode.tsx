'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { X, Keyboard, Flashlight, Loader2, ScanLine, CheckCircle2, Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { normalizeBarcode } from '@/lib/pharmacy-scan'

// Minimal shape of the native Barcode Detection API (not yet in lib.dom).
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => NativeBarcodeDetector

function getNativeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null
}

type Mode = 'starting' | 'scanning' | 'manual' | 'error'

/**
 * Reusable, hardware-free barcode scanner. Progressive enhancement:
 *   native BarcodeDetector → ZXing (dynamic import) → manual entry.
 * It contains NO pharmacy logic — it only emits a normalized code via
 * `onDetected`. A USB / Bluetooth scanner that "types" a code + Enter works
 * through the same manual input, so no hardware-specific code path is needed.
 */
export function ScanBarcode({
  onDetected, onClose, title,
}: { onDetected: (code: string) => void; onClose: () => void; title?: string }) {
  const t = useTranslations('scan')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const stoppedRef = useRef(false)
  // ZXing reader controls (from decodeFromVideoDevice), when used.
  const zxingRef = useRef<{ stop: () => void } | null>(null)

  const [mode, setMode] = useState<Mode>('starting')
  const [manual, setManual] = useState('')
  const [torchOn, setTorchOn] = useState(false)
  const [torchable, setTorchable] = useState(false)
  const [flash, setFlash] = useState(false)

  const stopCamera = useCallback(() => {
    stoppedRef.current = true
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    zxingRef.current?.stop()
    zxingRef.current = null
    streamRef.current?.getTracks().forEach(tr => tr.stop())
    streamRef.current = null
  }, [])

  const handleHit = useCallback((raw: string) => {
    const code = normalizeBarcode(raw)
    if (!code || stoppedRef.current) return
    stopCamera()
    setFlash(true)
    // Brief success flash before handing control back to the caller.
    setTimeout(() => { onDetected(code); onClose() }, 350)
  }, [onDetected, onClose, stopCamera])

  useEffect(() => {
    stoppedRef.current = false
    let cancelled = false

    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setMode('manual'); return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false,
        })
        if (cancelled) { stream.getTracks().forEach(tr => tr.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play().catch(() => {})

        // Torch capability (best-effort; not on all devices/browsers).
        const track = stream.getVideoTracks()[0]
        const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined
        setTorchable(!!caps?.torch)

        setMode('scanning')

        const NativeCtor = getNativeDetectorCtor()
        if (NativeCtor) {
          const detector = new NativeCtor()
          const tick = async () => {
            if (stoppedRef.current || cancelled) return
            try {
              const found = await detector.detect(video)
              if (found[0]?.rawValue) { handleHit(found[0].rawValue); return }
            } catch { /* transient decode error — keep scanning */ }
            rafRef.current = requestAnimationFrame(tick)
          }
          rafRef.current = requestAnimationFrame(tick)
        } else {
          // Fallback: ZXing browser reader (dynamic import — never SSR'd).
          try {
            const { BrowserMultiFormatReader } = await import('@zxing/browser')
            if (cancelled || stoppedRef.current) return
            const reader = new BrowserMultiFormatReader()
            const controls = await reader.decodeFromVideoElement(video, (result) => {
              if (result) handleHit(result.getText())
            })
            zxingRef.current = controls
          } catch {
            // No ZXing / decode init failed → manual entry still works.
          }
        }
      } catch {
        if (!cancelled) setMode('manual') // permission denied / no camera
      }
    }

    start()
    return () => { cancelled = true; stopCamera() }
  }, [handleHit, stopCamera])

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      const next = !torchOn
      await track.applyConstraints({ advanced: [{ torch: next }] as unknown as MediaTrackConstraintSet[] })
      setTorchOn(next)
    } catch { /* torch unsupported */ }
  }

  function submitManual() {
    const code = normalizeBarcode(manual)
    if (!code) return
    stopCamera()
    onDetected(code)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/95">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 text-white">
        <ScanLine className="h-5 w-5 text-teal-400" />
        <p className="flex-1 truncate text-sm font-semibold">{title ?? t('title')}</p>
        <button onClick={() => { stopCamera(); onClose() }} className="rounded-full p-1.5 hover:bg-white/10" aria-label={t('cancel')}>
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Camera / manual body */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {(mode === 'starting' || mode === 'scanning') && (
          <>
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            {/* Large scan target */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className={`relative h-48 w-72 max-w-[80vw] rounded-2xl border-2 ${flash ? 'border-emerald-400' : 'border-white/80'} transition-colors`}>
                <span className="absolute -left-0.5 -top-0.5 h-6 w-6 rounded-tl-2xl border-l-4 border-t-4 border-teal-400" />
                <span className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-tr-2xl border-r-4 border-t-4 border-teal-400" />
                <span className="absolute -bottom-0.5 -left-0.5 h-6 w-6 rounded-bl-2xl border-b-4 border-l-4 border-teal-400" />
                <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-br-2xl border-b-4 border-r-4 border-teal-400" />
                {!flash && <div className="absolute inset-x-4 top-1/2 h-0.5 animate-pulse bg-teal-400/80" />}
                {flash && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <CheckCircle2 className="h-16 w-16 animate-in zoom-in text-emerald-400" />
                  </div>
                )}
              </div>
            </div>
            {mode === 'starting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">{t('starting')}</p>
              </div>
            )}
            <p className="absolute bottom-4 left-0 right-0 text-center text-xs text-white/70">{t('hint')}</p>
          </>
        )}

        {mode === 'manual' && (
          <div className="flex w-full max-w-sm flex-col items-center gap-4 px-6 text-center text-white">
            <Camera className="h-10 w-10 text-white/40" />
            <p className="text-sm text-white/70">{t('manualPrompt')}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-3 bg-black/80 px-4 py-4">
        {/* Manual entry (always available — also the USB/Bluetooth path) */}
        <div className="flex gap-2">
          <Input
            value={manual}
            onChange={e => setManual(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitManual() }}
            placeholder={t('manualPlaceholder')}
            inputMode="numeric"
            autoFocus={mode === 'manual'}
            className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
          />
          <Button onClick={submitManual} disabled={!manual.trim()} className="shrink-0 gap-1.5">
            <Keyboard className="h-4 w-4" /> {t('enter')}
          </Button>
        </div>

        <div className="flex items-center justify-between">
          {torchable ? (
            <button
              onClick={toggleTorch}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm ${torchOn ? 'bg-amber-400 text-black' : 'bg-white/10 text-white'}`}
            >
              <Flashlight className="h-4 w-4" /> {t('torch')}
            </button>
          ) : <span />}
          <Button variant="ghost" onClick={() => { stopCamera(); onClose() }} className="text-white hover:bg-white/10">
            {t('cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
