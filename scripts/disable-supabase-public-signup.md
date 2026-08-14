# Disable Supabase public signup

In Supabase Dashboard → **Authentication** → **Providers** → **Email** (or **Auth** → **Settings**):

1. Turn **off** “Allow new users to sign up” / set `disable_signup` equivalent.
2. Prefer invite-only or admin-created accounts for Command Center.
3. Confirm new users get no `user_roles` / tenant access until an admin assigns them.

Do not create test accounts in production unless explicitly approved.
