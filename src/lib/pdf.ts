import type { Invoice, Clinic, Prescription, LabOrder, LabOrderItem, LabOrderPatientIdentity, LabResultFlag } from '@/types/database'

function formatXOF(amount: number) {
  return new Intl.NumberFormat('fr-SN', { style: 'currency', currency: 'XOF' }).format(amount)
}

function formatDateFR(date: string) {
  return new Intl.DateTimeFormat('fr-SN', { dateStyle: 'long' }).format(new Date(date))
}

// Escape user-entered text before it is interpolated into the print HTML. Names,
// notes, descriptions and medication fields can contain <, >, &, " or ' (common
// in Senegalese names/addresses) — without this they break the layout or inject
// markup into the printed document.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

const payerTypeLabel: Record<string, string> = {
  ipm: 'IPM', mutuelle: 'Mutuelle de santé', cnss: 'CNSS',
  ipres: 'IPRES', private: 'Assurance privée', other: 'Autre tiers payeur',
}

export function openInvoicePDF(invoice: Invoice, clinic: Clinic) {
  const patient = (invoice as { patient?: { full_name?: string; patient_number?: string; cni?: string } }).patient
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
  const insuranceShare = Number(invoice.insurance_share ?? 0)
  const patientShare = Number(invoice.total_amount) - insuranceShare
  const payerLine = insuranceShare > 0
    ? [invoice.payer_type ? payerTypeLabel[invoice.payer_type] : null, invoice.payer_name]
        .filter(Boolean).join(' — ')
    : ''
  // NINEA / RC are required on formal invoices in Senegal.
  const registrationLine = [
    clinic.ninea ? `NINEA: ${clinic.ninea}` : null,
    clinic.rc_number ? `RC: ${clinic.rc_number}` : null,
  ].filter(Boolean).join(' · ')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Facture ${invoice.invoice_number}</title>
<style>${baseStyles}</style></head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="clinic-name">${esc(clinic.name)}</div>
      <div class="clinic-meta">${esc(clinic.location)}${clinic.phone ? ' · ' + esc(clinic.phone) : ''}${clinic.email ? ' · ' + esc(clinic.email) : ''}</div>
      ${registrationLine ? `<div class="clinic-meta">${registrationLine}</div>` : ''}
    </div>
    <div>
      <div class="doc-title">FACTURE</div>
      <div class="doc-number">${invoice.invoice_number}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Patient</div>
      <div class="meta-value">${esc(patient?.full_name ?? '—')}</div>
      ${patient?.patient_number ? `<div style="font-size:12px;color:#888;font-family:monospace">${esc(patient.patient_number)}</div>` : ''}
      ${patient?.cni ? `<div style="font-size:12px;color:#888;font-family:monospace">CNI: ${esc(patient.cni)}</div>` : ''}
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
        <td>${esc(item.description)}</td>
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
    ${insuranceShare > 0 ? `
    <div class="total-row"><span>Part tiers payeur${payerLine ? ` (${esc(payerLine)})` : ''}</span><span>${formatXOF(insuranceShare)}</span></div>
    <div class="total-row"><span>Part patient</span><span>${formatXOF(patientShare)}</span></div>` : ''}
    <div class="total-row"><span>Montant payé</span><span style="color:#065f46">${formatXOF(Number(invoice.amount_paid))}</span></div>
    ${balance > 0 ? `<div class="total-row"><span>Reste à payer</span><span style="color:#dc2626;font-weight:600">${formatXOF(balance)}</span></div>` : ''}
  </div>

  ${invoice.notes ? `<div style="margin-top:24px;padding:12px 16px;background:#f8fafc;border-radius:8px;font-size:13px;color:#555"><strong>Notes:</strong> ${esc(invoice.notes)}</div>` : ''}

  <div class="footer">
    Généré par CHMS — ${esc(clinic.name)} · ${new Date().toLocaleDateString('fr-SN')}
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
      <div class="clinic-name">${esc(clinic.name)}</div>
      <div class="clinic-meta">${esc(clinic.location)}${clinic.phone ? ' · ' + esc(clinic.phone) : ''}</div>
      <div class="clinic-meta" style="margin-top:8px"><strong>Dr. ${esc(doctorName)}</strong></div>
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
      <div class="meta-value">${esc(patientName)}</div>
    </div>
  </div>

  <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#888;margin-bottom:12px">Médicaments prescrits</div>

  ${prescription.medications.map((m, i) => `
  <div class="med-card">
    <div class="med-name">${i + 1}. ${esc(m.name)} — ${esc(m.dosage)}${m.dosage_form ? ` <span style="font-weight:normal;color:#888;font-size:13px">(${esc(m.dosage_form)})</span>` : ''}</div>
    <div class="med-detail">${esc(m.frequency)} pendant ${esc(m.duration)}</div>
    ${m.instructions ? `<div class="med-detail" style="font-style:italic;color:#888">${esc(m.instructions)}</div>` : ''}
  </div>`).join('')}

  ${prescription.instructions ? `
  <div style="margin-top:16px;padding:12px 16px;background:#eff6ff;border-radius:8px;font-size:13px;color:#1e40af">
    <strong>Instructions générales:</strong> ${esc(prescription.instructions)}
  </div>` : ''}

  <div style="text-align:right;margin-top:40px">
    <div class="signature-line"></div>
    <div style="font-size:12px;color:#888">Signature du médecin</div>
  </div>

  <div class="footer">
    CHMS — ${esc(clinic.name)} · ${new Date().toLocaleDateString('fr-SN')}
  </div>
</div>
<script>window.onload = () => window.print()</script>
</body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}

const flagLabelFR: Record<LabResultFlag, string> = {
  normal: 'Normal', abnormal: 'Anormal', high: 'Élevé', low: 'Bas', critical: 'Critique',
}
const flagColorHex: Record<LabResultFlag, string> = {
  normal: '#111', abnormal: '#b45309', high: '#b91c1c', low: '#1d4ed8', critical: '#991b1b',
}

export function openLabResultPDF(
  order: LabOrder,
  items: LabOrderItem[],
  clinic: Clinic,
  identity: LabOrderPatientIdentity | null,
  doctorName: string,
  techName: string,
) {
  const registrationLine = [
    clinic.ninea ? `NINEA: ${clinic.ninea}` : null,
    clinic.rc_number ? `RC: ${clinic.rc_number}` : null,
  ].filter(Boolean).join(' · ')

  const rows = items.map(item => {
    const range = item.normal_range_text
      ?? (item.normal_range_low != null && item.normal_range_high != null ? `${item.normal_range_low} – ${item.normal_range_high}` : '—')
    const flag = item.flag as LabResultFlag
    const bold = flag !== 'normal'
    return `<tr>
      <td>${esc(item.test_name)}</td>
      <td style="text-align:right;color:${flagColorHex[flag]};${bold ? 'font-weight:bold' : ''}">${esc(item.result_value ?? '—')}</td>
      <td style="text-align:center">${esc(item.unit ?? '—')}</td>
      <td style="text-align:center">${esc(range)}</td>
      <td style="text-align:center;color:${flagColorHex[flag]};${bold ? 'font-weight:bold' : ''}">${flagLabelFR[flag]}</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Résultat d'analyse</title>
<style>${baseStyles}
.result-title { font-size: 24px; font-weight: bold; color: #0f766e; text-align: right; }
</style></head>
<body>
<div class="page">
  <div class="header" style="border-bottom-color:#0f766e">
    <div>
      <div class="clinic-name" style="color:#0f766e">${esc(clinic.name)}</div>
      <div class="clinic-meta">${esc(clinic.location)}${clinic.phone ? ' · ' + esc(clinic.phone) : ''}${clinic.email ? ' · ' + esc(clinic.email) : ''}</div>
      ${registrationLine ? `<div class="clinic-meta">${registrationLine}</div>` : ''}
    </div>
    <div>
      <div class="result-title">RÉSULTAT D'ANALYSE</div>
      <div style="font-size:13px;color:#888">${formatDateFR(order.created_at)}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <div class="meta-label">Patient</div>
      <div class="meta-value">${esc(identity?.full_name ?? order.patient_name ?? '—')}</div>
      ${(identity?.patient_number ?? order.patient_number) ? `<div style="font-size:12px;color:#888;font-family:monospace">${esc(identity?.patient_number ?? order.patient_number)}</div>` : ''}
      ${identity?.cni ? `<div style="font-size:12px;color:#888;font-family:monospace">CNI: ${esc(identity.cni)}</div>` : ''}
      ${identity?.date_of_birth ? `<div style="font-size:12px;color:#888">Né(e) le ${formatDateFR(identity.date_of_birth)}${identity.gender ? ' · ' + identity.gender : ''}</div>` : ''}
    </div>
    <div class="meta-box">
      <div class="meta-label">Prescripteur</div>
      <div class="meta-value">${esc(doctorName) || '—'}</div>
      ${order.priority !== 'normal' ? `<div style="font-size:12px;color:#b91c1c;text-transform:capitalize">${order.priority}</div>` : ''}
    </div>
  </div>

  <table>
    <thead><tr>
      <th style="width:36%">Analyse</th>
      <th style="text-align:right">Résultat</th>
      <th style="text-align:center">Unité</th>
      <th style="text-align:center">Valeurs de référence</th>
      <th style="text-align:center">Interprétation</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${order.interpretation ? `
  <div style="margin-top:16px;padding:12px 16px;background:#f0fdfa;border-radius:8px;font-size:13px;color:#0f766e">
    <strong>Interprétation:</strong> ${esc(order.interpretation)}
  </div>` : ''}

  <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px;color:#555">
    <div>
      <div style="border-top:1px solid #111;width:180px;padding-top:4px">Technicien de laboratoire</div>
      <div>${esc(techName) || '—'}</div>
    </div>
    <div style="text-align:right">
      <div style="border-top:1px solid #111;width:180px;padding-top:4px;margin-left:auto">Médecin validateur</div>
      <div>${order.reviewed_by ? esc(order.reviewer?.full_name ?? doctorName) : '—'}${order.reviewed_at ? ' · ' + formatDateFR(order.reviewed_at) : ''}</div>
    </div>
  </div>

  <div class="footer">
    Généré par CHMS — ${esc(clinic.name)} · ${new Date().toLocaleDateString('fr-SN')}
  </div>
</div>
<script>window.onload = () => window.print()</script>
</body></html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
}
