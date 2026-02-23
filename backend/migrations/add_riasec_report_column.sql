-- Migration: Add riasec_report column to interpreted_results table
-- This column stores cached RIASEC reports as JSON

-- Check if column exists before adding
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'interpreted_results' 
        AND column_name = 'riasec_report'
    ) THEN
        ALTER TABLE interpreted_results 
        ADD COLUMN riasec_report JSON;
        
        COMMENT ON COLUMN interpreted_results.riasec_report IS 'Cached RIASEC report with scores and report text';
        
        RAISE NOTICE 'Column riasec_report added to interpreted_results table';
    ELSE
        RAISE NOTICE 'Column riasec_report already exists in interpreted_results table';
    END IF;
END $$;

