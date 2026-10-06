
-- OLT type column
ALTER TABLE public.olts ADD COLUMN IF NOT EXISTS olt_type TEXT;

CREATE TABLE IF NOT EXISTS public.olt_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  olt_id UUID NOT NULL REFERENCES public.olts(id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL,
  card_type TEXT NOT NULL CHECK (card_type IN ('GTGO', 'GTGH', 'GPFA', 'GPBD', 'OTHER')),
  card_label TEXT,
  port_count INTEGER NOT NULL DEFAULT 8,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (olt_id, slot_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.olt_cards TO anon, authenticated;
GRANT ALL ON public.olt_cards TO service_role;
ALTER TABLE public.olt_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public access olt_cards" ON public.olt_cards FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.olt_ports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES public.olt_cards(id) ON DELETE CASCADE,
  port_number INTEGER NOT NULL,
  sfp_model TEXT,
  sfp_serial TEXT,
  sfp_tx_power TEXT,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'reserved', 'damaged')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (card_id, port_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.olt_ports TO anon, authenticated;
GRANT ALL ON public.olt_ports TO service_role;
ALTER TABLE public.olt_ports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public access olt_ports" ON public.olt_ports FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER olt_cards_set_updated_at BEFORE UPDATE ON public.olt_cards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER olt_ports_set_updated_at BEFORE UPDATE ON public.olt_ports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
