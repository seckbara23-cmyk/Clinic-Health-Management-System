import { redirect } from 'next/navigation'

// The lab module moved to /lab-orders (Phase 4). The legacy lab_requests table
// is kept read-only for historical data and migrated into lab_orders.
export default function LegacyLabRequestsPage() {
  redirect('/lab-orders')
}
