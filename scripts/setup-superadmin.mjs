import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://qnbtawtgholvccbpdjpx.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuYnRhd3RnaG9sdmNjYnBkanB4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njk0OTcyMiwiZXhwIjoyMDkyNTI1NzIyfQ.i4ZIf1yQ3VovNRDXihk_eU2KgfoHbjzTlG03TW6p_yA'

const TARGET_EMAIL = 'seckbara23@gmail.com'
const NEW_PASSWORD  = 'Senegalmaroc1$'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// 1. Create the auth user directly (confirmed, no email required)
const { data: created, error: createError } = await supabase.auth.admin.createUser({
  email: TARGET_EMAIL,
  password: NEW_PASSWORD,
  email_confirm: true,
  user_metadata: { full_name: 'Super Admin', role: 'super_admin' },
})

if (createError) {
  // If already exists, fetch and update instead
  if (createError.message.includes('already been registered') || createError.message.includes('already exists')) {
    console.log('User already exists — looking up by email...')
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    if (listError) { console.error('listUsers failed:', listError.message); process.exit(1) }
    const existing = users.find(u => u.email === TARGET_EMAIL)
    if (!existing) { console.error('Could not find existing user'); process.exit(1) }

    const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
      password: NEW_PASSWORD,
      email_confirm: true,
    })
    if (updateError) { console.error('update failed:', updateError.message); process.exit(1) }

    await supabase.from('user_profiles').upsert({
      id: existing.id, email: TARGET_EMAIL, full_name: 'Super Admin', role: 'super_admin',
    })
    console.log('✓ Existing user updated — password set + role = super_admin')
  } else {
    console.error('createUser failed:', createError.message)
    process.exit(1)
  }
} else {
  const uid = created.user.id
  console.log(`✓ User created: ${uid}`)

  // 2. Upsert the user_profile row with super_admin role
  const { error: profileError } = await supabase.from('user_profiles').upsert({
    id: uid,
    email: TARGET_EMAIL,
    full_name: 'Super Admin',
    role: 'super_admin',
    is_active: true,
  })
  if (profileError) { console.error('profile upsert failed:', profileError.message); process.exit(1) }
  console.log('✓ user_profiles row created with role = super_admin')
}

console.log('\nDone! Log in at /login with:')
console.log(`  Email:    ${TARGET_EMAIL}`)
console.log(`  Password: ${NEW_PASSWORD}`)
