-- Run in Supabase → SQL Editor (once per project).
-- Step 1: see what enum labels already exist
SELECT unnest(enum_range(NULL::app_role)) AS app_role_label;

-- Step 2: add a dedicated super-admin label (skip if you prefer an existing label from step 1)
-- If this fails with "already exists", you can use that label as SUPABASE_SUPER_ADMIN_ROLE instead.
ALTER TYPE app_role ADD VALUE 'super_admin';
