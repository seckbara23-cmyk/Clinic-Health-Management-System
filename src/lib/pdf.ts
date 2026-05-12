import type { Invoice, Clinic, Prescription } from '@/types/database'

function formatXOF(amount: number) {
  return new Intl.NumberFormat('fr-SN', { style: 'currency', currency: 'XOF' }).format(amount)
}

function formatDateFR(date: string) {
  return new Intl.DateTimeFormat('fr-SN', { dateStyle: 'long' }).format(new Date(date))
}

const baseStyles = `
  body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 0; }
  .page { max-width: 680px; margin: 0 auto; padding: 40px 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 24px; }
  .clinic-name { font-size: 20px; font-weight: bold; color: #2563eb; }
  .clinic-meta { font-size: 12px; color: #666; margin-top: 4px; }
  .doc-title { font-size: 24px; font-weight: bold; color: #111; text-align: right; }
  .doc-number { font-size: 13px; color: #2563eb; font-family: monospace; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .meta-box { background: #f8fafc; border-radius: 8px; padding: 12px 16px; }
  .meta-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .meta-value { font-size: 14px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  th { background: #eff6ff; text-align: left; padding: 10px 12px; font-size: 12px; color: #2563eb; font-weight: 600; }
  td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid #e5e7eb; }
  tr:last-child td { border-bottom: none; }
  .totals { margin-left: auto; width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; color: #555; }
  .total-final { display: flex; justify-content: space-between; padding: 10px 0; font-size: 16px; font-weight: bold; border-top: 2px solid #2563eb; margin-top: 8px; color: #1d4ed8; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; }
  .badge-paid { background: #d1fae5; color: #065f46; }
  .badge-partial { background: #fef3c7; color: #92400e; }
  .badge-draft { background: #f1f5f9; color: #475569; }
  .footer { margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #9ca3af; text-align: center; }
  @media print { @page { margin: 20mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
`

export function openInvoicePDF(invoice: Invoice, clinic: Clinic) {
  const patient = (invoice as { patient?: { full_name?: string; patient_number?: string } }).patient
  const items = invoice.line_items as Array<{ description: string; quantity: number; unit_price: number; total: number }>

  const statusLabel: Record<string, string> = {
    paid: 'Payée', partial: 'Paiement partiel', draft: 'Brouillon',
    sent: 'Envoyée', overdue: 'En retard', cancelled: 'Annulée',
  }
  const badgeClass: Record<string, string> = {
    paid: 'badge-paid', partial: 'badge-partial',
    draft: 'badge-draft', sent: 'badge-draft', overdue: 'badge-draft', cancelled: 'badge-draft',
  }
  const balance = Number(invoice.total_amount) - Number(invoice.amount_paid)

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Facture ${invoice.invoice_number}</title>
<style>${baseStyles}</style></head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="clinic-name">${clinic.name}</div>
      <div class="clinic-meta">${clinic.location}${clinic.phone ? ' · ' + clinic.phone : ''}${clinic.email ? ' · ' + clinic.email : ''}</div>
    </div>
    <div>
      <div class="doc-title">FACTURE</div>
      <div class="doc-number">${invoice.invoice_number}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Patient</div>
      <div class="meta-value">${patient?.full_name ?? '—'}</div>
      ${patient?.patient_number ? `<div style="font-size:12px;color:#888;font-family:monospace">${patient.patient_number}</div>` : ''}
    </div>
    <div class="meta-box">
      <div class="meta-label">Date d'émission</div>
      <div class="meta-value">${formatDateFR(invoice.created_at)}</div>
      ${invoice.due_date ? `<div style="font-size:12px;color:#888">Échéance: ${formatDateFR(invoice.due_date)}</div>` : ''}
    </div>
    <div class="meta-box">
      <div class="meta-label">Statut</div>
      <div style="margin-top:4px"><span class="badge ${badgeClass[invoice.status] ?? 'badge-draft'}">${statusLabel[invoice.status] ?? invoice.status}</span></div>
    </div>
    ${invoice.payment_method ? `
    <div class="meta-box">
      <div class="meta-label">Mode de paiement</div>
      <div class="meta-value" style="text-transform:capitalize">${invoice.payment_method.replace('_', ' ')}</div>
    </div>` : '<div></div>'}
  </div>

  <table>
    <thead><tr>
      <th style="width:50%">Description</th>
      <th style="text-align:center">Qté</th>
      <th style="text-align:right">Prix unitaire</th>
      <th style="text-align:right">Total</th>
    </tr></thead>
    <tbody>
      ${items.map(item => `
      <tr>
        <td>${item.description}</td>
        <td style="text-align:center">${item.quantity}</td>
        <td style="text-align:right">${formatXOF(item.unit_price)}</td>
        <td style="text-align:right">${formatXOF(item.quantity * item.unit_price)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="total-row"><span>Sous-total</span><span>${formatXOF(Number(invoice.subtotal))}</span></div>
    ${Number(invoice.discount_amount) > 0 ? `<div class="total-row"><span>Remise</span><span>- ${formatXOF(Number(invoice.discount_amount))}</span></div>` : ''}
    ${Number(invoice.tax_amount) > 0 ? `<div class="total-row"><span>Taxes</span><span>${formatXOF(Number(invoice.tax_amount))}</span></div>` : ''}
    <div class="total-final"><span>Total</span><span>${formatXOF(Number(invoice.total_amount))}</span></div>
    <div class="total-row"><span>Montant payé</span><span style="color:#065f46">${formatXOF(Number(invoice.amount_paid))}</span></div>
    ${balance > 0 ? `<div class="total-row"><span>Reste à payer</span><span style="color:#dc2626;font-weight:600">${formatXOF(balance)}</span></div>` : ''}
  </div>

  ${invoice.notes ? `<div style="margin-top:24px;padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:13px;color:#555"><strong>Notes:</strong> ${invoice.notes}</div>` : ''}

  <div class="footer">
    Généré par CHMS — ${clinic.name} · ${new Date().toLocaleDateString('fr-SN')}
  </div>
</div>
<script>window.onload = () => window.print()</script>
</body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

export function openPrescriptionPDF(
  prescription: Prescription,
  clinic: Clinic,
  patientName: string,
  doctorName: string,
) {
  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Ordonnance</title>
<style>
${baseStyles}
.rx-header { font-size: 28px; font-style: italic; color: #2563eb; margin-bottom: 4px; }
.med-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
.med-name { font-size: 15px; font-weight: bold; }
.med-detail { font-size: 13px; color: #555; margin-top: 4px; }
.signature-line { border-top: 1px solid #111; width: 200px; margin: 48px 0 4px auto; }
</style></head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="clinic-name">${clinic.name}</div>
      <div class="clinic-meta">${clinic.location}${clinic.phone ? ' · ' + clinic.phone : ''}</div>
      <div class="clinic-meta" style="margin-top:8px"><strong>Dr. ${doctorName}</strong></div>
    </div>
    <div style="text-align:right">
      <div class="rx-header">Ordonnance</div>
      <div style="font-size:13px;color:#888">${formatDateFR(prescription.created_at)}</div>
      ${prescription.valid_until ? `<div style="font-size:12px;color:#dc2626">Valable jusqu'au ${formatDateFR(prescription.valid_until)}</div>` : ''}
    </div>
  </div>

  <div class="meta-grid" style="grid-template-columns: 1fr; margin-bottom: 28px;">
    <div class="meta-box">
      <div class="meta-label">Patient</div>
      <div class="meta-value">${patientName}</div>
    </div>
  </div>

  <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#888;margin-bottom:12px">Médicaments prescrits</div>

  ${prescription.medications.map((m, i) => `
  <div class="med-card">
    <div class="med-name">${i + 1}. ${m.name} — ${m.dosage}</div>
    <div class="med-detail">${m.frequency} pendant ${m.duration}</div>
    ${m.instructions ? `<div class="med-detail" style="font-style:italic;color:#888">${m.instructions}</div>` : ''}
  </div>`).join('')}

  ${prescription.instructions ? `
  <div style="margin-top:16px;padding:12px 16px;background:#eff6ff;border-radius:8px;font-size:13px;color:#1e40af">
    <strong>Instructions générales:</strong> ${prescription.instructions}
  </div>` : ''}

  <div style="text-align:right;margin-top:40px">
    <div class="signature-line"></div>
    <div style="font-size:12px;color:#888">Signature du médecin</div>
  </div>

  <div class="footer">
    CHMS — ${clinic.name} · ${new Date().toLocaleDateString('fr-SN')}
  </div>
</div>
<script>window.onload = () => window.print()</script>
</body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
