
ALTER TABLE public.pattern_states ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
CREATE POLICY "srv_pattern_states" ON public.pattern_states FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
