-- Create deep_search_history table for saving search results
CREATE TABLE IF NOT EXISTS deep_search_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  answer text,
  sources jsonb DEFAULT '[]'::jsonb,
  model text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deep_search_history_created_at 
  ON deep_search_history(created_at DESC);

-- Allow service role full access (worker uses service role key)
ALTER TABLE deep_search_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_full_access" ON deep_search_history
  USING (true) WITH CHECK (true);
