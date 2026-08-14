-- Per-machine preventive maintenance records
-- Each row = one PM activity done on one machine on one date

CREATE TABLE IF NOT EXISTS public.machine_pm_records (
  id              text PRIMARY KEY,
  machine_id      text NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  machine_code    text DEFAULT '',
  machine_name    text DEFAULT '',
  plant_section   text DEFAULT '',
  pm_date         date NOT NULL,
  pm_type         text DEFAULT 'Preventive',
  task            text DEFAULT '',
  status          text DEFAULT 'completed' CHECK (status IN ('completed','pending','overdue','skipped')),
  completed       boolean DEFAULT true,
  action          text DEFAULT '',
  technician      text DEFAULT '',
  remarks         text DEFAULT '',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_machine_pm_records_machine ON public.machine_pm_records (machine_id, pm_date DESC);
CREATE INDEX IF NOT EXISTS idx_machine_pm_records_section ON public.machine_pm_records (plant_section, pm_date DESC);

ALTER TABLE public.machine_pm_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public machine_pm_records access" ON public.machine_pm_records;
CREATE POLICY "public machine_pm_records access"
ON public.machine_pm_records
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'machine_pm_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.machine_pm_records;
  END IF;
END
$$;
