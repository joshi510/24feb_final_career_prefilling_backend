# Student Registration Fields Migration

## Overview
This migration adds new required fields to the `students` table for the updated student registration form.

## New Fields Added

1. **first_name** (VARCHAR(100), NOT NULL)
2. **last_name** (VARCHAR(100), NOT NULL)
3. **contact_number** (VARCHAR(10), NOT NULL, UNIQUE)
4. **parent_contact_number** (VARCHAR(10), NOT NULL)
5. **school_institute_name** (VARCHAR(200), NOT NULL)
6. **current_education** (VARCHAR(50), NOT NULL)
7. **stream** (VARCHAR(50), NOT NULL)
8. **family_annual_income** (VARCHAR(50), NOT NULL)

## How to Run

### Option 1: Using psql (PostgreSQL Command Line)
```bash
psql -U your_username -d your_database_name -f migrations/add_student_fields.sql
```

### Option 2: Using pgAdmin or Database GUI
1. Open your database management tool (pgAdmin, DBeaver, etc.)
2. Connect to your database
3. Open the file `migrations/add_student_fields.sql`
4. Execute the entire script

### Option 3: Using Node.js/Sequelize (if you have a migration runner)
If you have a migration runner set up, you can execute the SQL file programmatically.

## Important Notes

### For Existing Records
The migration script handles existing records by:
- **first_name/last_name**: Extracts from `users.full_name` (splits on first space)
- **contact_number**: Copies from `mobile_number` if available (takes first 10 digits)
- **parent_contact_number**: Sets to empty string (you may need to update manually)
- **school_institute_name**: Sets to empty string (you may need to update manually)
- **current_education**: Copies from `education` field, defaults to '10th' if not available
- **stream**: Tries to infer from `education` field, defaults to 'Science'
- **family_annual_income**: Sets default to '<4 Lacs'

### Potential Issues

1. **Duplicate Contact Numbers**: If you have duplicate `mobile_number` values in existing records, the unique constraint on `contact_number` may fail. You'll need to resolve duplicates first.

2. **Empty Contact Numbers**: If existing records don't have `mobile_number`, `contact_number` will be set to empty string. You may need to update these manually.

3. **Missing Data**: Some fields (parent_contact_number, school_institute_name) will be set to empty strings for existing records. Consider updating these manually if needed.

## Verification

After running the migration, verify the columns were added:

```sql
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
```

## Rollback (if needed)

If you need to rollback this migration, you can run:

```sql
ALTER TABLE students 
    DROP COLUMN IF EXISTS first_name,
    DROP COLUMN IF EXISTS last_name,
    DROP COLUMN IF EXISTS contact_number,
    DROP COLUMN IF EXISTS parent_contact_number,
    DROP COLUMN IF EXISTS school_institute_name,
    DROP COLUMN IF EXISTS current_education,
    DROP COLUMN IF EXISTS stream,
    DROP COLUMN IF EXISTS family_annual_income;

-- Also drop the unique constraint if it exists
ALTER TABLE students 
    DROP CONSTRAINT IF EXISTS students_contact_number_unique;
```

## Testing

After running the migration:
1. Test the student registration form with new fields
2. Verify that new registrations save all fields correctly
3. Check that existing student records have been populated with default values
4. Update any existing records that need proper values for the new fields

