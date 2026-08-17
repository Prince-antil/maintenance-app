-- Plant sections table for cross-device sync of user-added sections.
-- Previously stored only in localStorage (lost on browser data clear,
-- not shared across PCs). Now persisted in Supabase with Realtime.

CREATE TABLE IF NOT EXISTS public.plant_sections (
  id          text PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  created_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plant_sections_name ON public.plant_sections (name);

ALTER TABLE public.plant_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public plant_sections access" ON public.plant_sections;
CREATE POLICY "public plant_sections access"
ON public.plant_sections
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'plant_sections'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.plant_sections;
  END IF;
END
$$;
