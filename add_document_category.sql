-- Add category to distinguish between user uploads and admin results
ALTER TABLE public.documents 
ADD COLUMN IF NOT EXISTS category text DEFAULT 'input'; -- 'input', 'result'

-- Update existing records to be 'input' (default handles new ones, but good to be explicit if needed, though default covers it)
-- No need to update if column added with default.

-- Allow users to read 'result' files (they own the task)
-- RLS for 'documents' already checks (auth.uid() = user_id), so if we insert with the task's user_id, the user can see it.
-- We just need to ensure Storage RLS allows the user to download from the results path.

