-- =====================================================
-- MIGRATION: Add New Student Registration Fields
-- =====================================================
-- This script adds new required fields to the students table
-- for the updated student registration form
-- PostgreSQL compatible
-- =====================================================

-- =====================================================
-- STUDENTS TABLE - New Registration Fields
-- =====================================================

-- Add first_name column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' 
        AND column_name = 'first_name'
    ) THEN
        ALTER TABLE students 
        ADD COLUMN first_name VARCHAR(100) NOT NULL DEFAULT '';
        
        RAISE NOTICE 'Added column: students.first_name';
    ELSE
        RAISE NOTICE 'Column already exists: students.first_name';
    END IF;
END $$;

-- Add last_name column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' 
        AND column_name = 'last_name'
    ) THEN
        ALTER TABLE students 
        ADD COLUMN last_name VARCHAR(100) NOT NULL DEFAULT '';
        
        RAISE NOTICE 'Added column: students.last_name';
    ELSE
        RAISE NOTICE 'Column already exists: students.last_name';
    END IF;
END $$;

-- Add contact_number column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' 
        AND column_name = 'contact_number'
    ) THEN
        ALTER TABLE students 
        ADD COLUMN contact_number VARCHAR(10) NOT NULL DEFAULT '';
        
        -- Add unique constraint (will only apply to new records)
        BEGIN
            ALTER TABLE students 
            ADD CONSTRAINT students_contact_number_unique UNIQUE (contact_number);
            RAISE NOTICE 'Added unique constraint: students.contact_number';
        EXCEPTION WHEN duplicate_table THEN
            RAISE NOTICE 'Unique constraint already exists: students.contact_number';
        END;
        
        RAISE NOTICE 'Added column: students.contact_number';
    ELSE
        RAISE NOTICE 'Column already exists: students.contact_number';
    END IF;
END $$;

-- Add parent_contact_number column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' 
        AND column_name = 'parent_contact_number'
    ) THEN
        ALTER TABLE students 
        ADD COLUMN parent_contact_number VARCHAR(10) NOT NULL DEFAULT '';
        
        RAISE NOTICE 'Added column: students.parent_contact_number';
    ELSE
        RAISE NOTICE 'Column already exists: students.parent_contact_number';
    END IF;
END $$;

-- Add school_institute_name column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' 
        AND column_name = 'school_institute_name'
    ) THEN
        ALTER TABLE students 
        ADD COLUMN school_institute_name VARCHAR(200) NOT NULL DEFAULT '';
        
        RAISE NOTICE 'Added column: students.school_institute_name';
    ELSE
        RAISE NOTICE 'Column already exists: students.school_institute_name';
    END IF;
END $$;

-- Add current_education column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' 
        AND column_name = 'current_education'
    ) THEN
        ALTER TABLE students 
        ADD COLUMN current_education VARCHAR(50) NOT NULL DEFAULT '10th';
        
        RAISE NOTICE 'Added column: students.current_education';
    ELSE
        RAISE NOTICE 'Column already exists: students.current_education';
    END IF;
END $$;

-- Add stream column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' 
        AND column_name = 'stream'
    ) THEN
        ALTER TABLE students 
        ADD COLUMN stream VARCHAR(50) NOT NULL DEFAULT 'Science';
        
        RAISE NOTICE 'Added column: students.stream';
    ELSE
        RAISE NOTICE 'Column already exists: students.stream';
    END IF;
END $$;

-- Add family_annual_income column (if missing)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'students' 
        AND column_name = 'family_annual_income'
    ) THEN
        ALTER TABLE students 
        ADD COLUMN family_annual_income VARCHAR(50) NOT NULL DEFAULT '<4 Lacs';
        
        RAISE NOTICE 'Added column: students.family_annual_income';
    ELSE
        RAISE NOTICE 'Column already exists: students.family_annual_income';
    END IF;
END $$;

-- =====================================================
-- VERIFICATION QUERIES (Optional - run separately)
-- =====================================================
-- Uncomment to verify columns were added:
/*
SELECT 
    column_name, 
    data_type, 
    character_maximum_length,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'students'
    AND column_name IN (
        'first_name', 'last_name', 'contact_number', 
        'parent_contact_number', 'school_institute_name',
        'current_education', 'stream', 'family_annual_income'
    )
ORDER BY column_name;
*/

-- =====================================================
-- END OF MIGRATION
-- =====================================================

