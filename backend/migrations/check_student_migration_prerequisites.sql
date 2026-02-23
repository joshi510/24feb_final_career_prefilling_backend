-- =====================================================
-- PRE-MIGRATION CHECK: Student Fields Migration
-- =====================================================
-- Run this BEFORE running add_student_fields.sql
-- This will help identify potential issues
-- =====================================================

-- Check 1: Count existing students
SELECT 
    'Total students' AS check_type,
    COUNT(*) AS count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ No existing records - safe to migrate'
        WHEN COUNT(*) > 0 THEN '⚠️ ' || COUNT(*) || ' existing records - migration will set defaults'
    END AS status
FROM students;

-- Check 2: Check for duplicate mobile numbers (will affect contact_number unique constraint)
SELECT 
    'Duplicate mobile numbers' AS check_type,
    COUNT(*) AS duplicate_count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ No duplicates found - unique constraint will work'
        WHEN COUNT(*) > 0 THEN '❌ ' || COUNT(*) || ' duplicates found - need to resolve before migration'
    END AS status
FROM (
    SELECT mobile_number, COUNT(*) as cnt
    FROM students
    WHERE mobile_number IS NOT NULL 
    AND mobile_number != ''
    AND LENGTH(REPLACE(mobile_number, ' ', '')) >= 10
    GROUP BY mobile_number
    HAVING COUNT(*) > 1
) duplicates;

-- Check 3: Show students without mobile_number (contact_number will be empty)
SELECT 
    'Students without mobile number' AS check_type,
    COUNT(*) AS count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ All students have mobile numbers'
        WHEN COUNT(*) > 0 THEN '⚠️ ' || COUNT(*) || ' students without mobile - contact_number will be empty'
    END AS status
FROM students
WHERE mobile_number IS NULL 
OR mobile_number = ''
OR LENGTH(REPLACE(mobile_number, ' ', '')) < 10;

-- Check 4: Check if any of the new columns already exist
SELECT 
    'Existing columns check' AS check_type,
    column_name,
    CASE 
        WHEN column_name IS NOT NULL THEN '⚠️ Column already exists - migration will skip'
        ELSE '✅ Column does not exist - will be created'
    END AS status
FROM information_schema.columns 
WHERE table_name = 'students'
    AND column_name IN (
        'first_name', 'last_name', 'contact_number', 
        'parent_contact_number', 'school_institute_name',
        'current_education', 'stream', 'family_annual_income'
    )
ORDER BY column_name;

-- Check 5: Sample of students that will need manual updates
SELECT 
    'Sample records needing updates' AS check_type,
    s.id,
    u.full_name,
    s.mobile_number,
    CASE 
        WHEN s.mobile_number IS NULL OR s.mobile_number = '' THEN '❌ No contact number'
        WHEN LENGTH(REPLACE(s.mobile_number, ' ', '')) < 10 THEN '❌ Invalid contact number'
        ELSE '✅ Has contact number'
    END AS contact_status
FROM students s
JOIN users u ON s.user_id = u.id
WHERE s.mobile_number IS NULL 
   OR s.mobile_number = ''
   OR LENGTH(REPLACE(s.mobile_number, ' ', '')) < 10
LIMIT 10;

-- Summary
SELECT 
    '=== MIGRATION READINESS SUMMARY ===' AS summary;

-- Final recommendation
SELECT 
    CASE 
        WHEN (
            SELECT COUNT(*) FROM (
                SELECT mobile_number, COUNT(*) as cnt
                FROM students
                WHERE mobile_number IS NOT NULL 
                AND mobile_number != ''
                AND LENGTH(REPLACE(mobile_number, ' ', '')) >= 10
                GROUP BY mobile_number
                HAVING COUNT(*) > 1
            ) duplicates
        ) > 0 THEN 
            '❌ NOT READY: Duplicate mobile numbers found. Resolve duplicates before migration.'
        WHEN (
            SELECT COUNT(*) FROM information_schema.columns 
            WHERE table_name = 'students'
            AND column_name IN ('first_name', 'last_name', 'contact_number')
        ) = 3 THEN
            '✅ ALREADY MIGRATED: Key columns already exist. Migration will skip existing columns.'
        ELSE
            '✅ READY: No blocking issues found. Safe to run migration.'
    END AS migration_status;

