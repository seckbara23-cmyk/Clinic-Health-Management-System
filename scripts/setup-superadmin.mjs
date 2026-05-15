/**
 * One-time script to create/update the super_admin user.
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   SUPERADMIN_EMAIL=you@example.com \
 *   SUPERADMIN_PASSWORD=... \
 *   node scripts/setup-superadmin.mjs
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.SUPABASE_URL      || process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const TARGET_EMAIL      = process.env.SUPERADMIN_EMAIL
const NEW_PASSWORD      = process.env.SUPERADMIN_PASSWORD
const FULL_NAME         = process.env.SUPERADMIN_NAME || 'Super Admin'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TARGET_EMAIL || !NEW_PASSWORD) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 1. Find existing user by email
console.log(`Looking up ${TARGET_EMAIL}...`)
const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
if (listError) { console.error('listUsers failed:', listError.message); process.exit(1) }

let uid
const existing = users.find(u => u.email === TARGET_EMAIL)

if (existing) {
  uid = existing.id
  console.log(`Found existing user (${uid}) — updating password...`)
  const { error: updateError } = await supabase.auth.admin.updateUserById(uid, {
    password: NEW_PASSWORD,
    email_confirm: true,
  })
  if (updateError) { console.error('update failed:', updateError.message); process.exit(1) }
  console.log('✓ Password updated')
} else {
  console.log('No existing user — creating...')
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: TARGET_EMAIL,
    password: NEW_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: FULL_NAME, role: 'super_admin' },
  })
  if (createError) { console.error('createUser failed:', createError.message); process.exit(1) }
  uid = created.user.id
  console.log(`✓ User created (${uid})`)
  await new Promise(r => setTimeout(r, 800))
}

// 2. Upsert user_profiles with super_admin role
const { error: profileError } = await supabase.from('user_profiles').upsert({
  id: uid,
  email: TARGET_EMAIL,
  full_name: FULL_NAME,
  role: 'super_admin',
  is_active: true,
})
if (profileError) { console.error('profile upsert failed:', profileError.message); process.exit(1) }
console.log('✓ user_profiles role = super_admin')

console.log('\nDone! Log in at /login with:')
console.log(`  Email:    ${TARGET_EMAIL}`)
console.log(`  Role:     super_admin`)
