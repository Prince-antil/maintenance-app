-- Energy logs table for cloud sync.
-- The cloud_sync_schema.sql did not include energy_logs; this migration
-- creates the full table with all columns the client sends via energyToCloudRow().

CREATE TABLE IF NOT EXISTS public.energy_logs (
  id                     text PRIMARY KEY,
  date                   date NOT NULL,
  source                 text NOT NULL DEFAULT '',
  remarks                text NOT NULL DEFAULT '',
  plant_section          text NOT NULL DEFAULT '',
  dg500_run_hours        numeric(10, 2) NOT NULL DEFAULT 0,
  dg380_run_hours        numeric(10, 2) NOT NULL DEFAULT 0,
  fuel_consumed_litres   numeric(10, 2) NOT NULL DEFAULT 0,
  solar_generation_kwh   numeric(10, 2) NOT NULL DEFAULT 0,
  uhbvnl_unit1_kwh       numeric(12, 2) NOT NULL DEFAULT 0,
  uhbvnl_unit2_kwh       numeric(12, 2) NOT NULL DEFAULT 0,
  total_grid_kwh         numeric(12, 2) NOT NULL DEFAULT 0,
  dg_kwh                 numeric(12, 2) NOT NULL DEFAULT 0,
  total_kwh              numeric(12, 2) NOT NULL DEFAULT 0,
  plant_sec              numeric(10, 2) NOT NULL DEFAULT 0,
  kwh                    numeric(10, 2) NOT NULL DEFAULT 0,
  section_consumption    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_energy_logs_date ON public.energy_logs (date DESC);
CREATE INDEX IF NOT EXISTS idx_energy_logs_section ON public.energy_logs (plant_section, date DESC);

ALTER TABLE public.energy_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public energy access" ON public.energy_logs;
CREATE POLICY "public energy access"
ON public.energy_logs
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'energy_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.energy_logs;
  END IF;
END
$$;
