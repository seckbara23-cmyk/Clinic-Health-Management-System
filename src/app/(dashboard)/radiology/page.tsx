'use client'

// ── Radiology worklist + reporting workspace (Phase 39 — Radiora) ──
// Radiologist-facing worklist; opening an order launches the reporting workspace.
// CHMS owns the patient / order / access; Radiora owns the reporting workspace.

import { useState } from 'react'
import { RadiologyWorklist } from '@/components/radiology/RadiologyWorklist'
import { ReportWorkspace } from '@/components/radiology/ReportWorkspace'
import type { WorklistOrder } from '@/hooks/useRadiology'

export default function RadiologyPage() {
  const [selected, setSelected] = useState<WorklistOrder | null>(null)
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      {selected
        ? <ReportWorkspace order={selected} onBack={() => setSelected(null)} />
        : <RadiologyWorklist onOpen={setSelected} />}
    </div>
  )
}
