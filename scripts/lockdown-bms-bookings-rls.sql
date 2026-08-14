-- Run in Supabase → SQL Editor.
-- Critical: deny anonymous reads of customer booking data on bms_bookings.
--
-- After running, verify with the publishable key (expect []):
--   curl "https://<project>.supabase.co/rest/v1/bms_bookings?select=*&limit=1" \
--     -H "apikey: <publishable-key>" \
--     -H "Authorization: Bearer <publishable-key>"

ALTER TABLE public.bms_bookings ENABLE ROW LEVEL SECURITY;

-- Drop permissive anon policies if present (names vary — adjust if your project differs).
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'bms_bookings'
      AND (
        roles = '{anon}'
        OR qual ILIKE '%anon%'
        OR policyname ILIKE '%anon%'
        OR policyname ILIKE '%public%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.bms_bookings', pol.policyname);
  END LOOP;
END $$;

-- Explicit deny for anonymous role (optional hard stop).
DROP POLICY IF EXISTS deny_anon_select_bms_bookings ON public.bms_bookings;

-- Authenticated reads only — tighten USING to tenant/owner/branch as needed.
DROP POLICY IF EXISTS authenticated_select_bms_bookings ON public.bms_bookings;
CREATE POLICY authenticated_select_bms_bookings
  ON public.bms_bookings
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Service role bypasses RLS by default; keep writes via backend service role.
-- Add INSERT/UPDATE/DELETE policies only if clients must mutate via user JWTs.
