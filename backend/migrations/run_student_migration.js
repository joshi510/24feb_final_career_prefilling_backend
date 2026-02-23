const fs = require('fs');
const path = require('path');
const { sequelize } = require('../database');

async function runMigration() {
  try {
    console.log('\n🔵 Starting Student Fields Migration...\n');
    
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established\n');
    
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'add_student_fields.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('🔵 Executing migration SQL...\n');
    
    // Execute the migration
    await sequelize.query(sql);
    
    console.log('\n✅ Migration completed successfully!\n');
    
    // Verify the columns were added
    console.log('🔵 Verifying migration...\n');
    const [results] = await sequelize.query(`
      SELECT 
          column_name, 
          data_type, 
          character_maximum_length,
          is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'students'
          AND column_name IN (
              'first_name', 'last_name', 'contact_number', 
              'parent_contact_number', 'school_institute_name',
              'current_education', 'stream', 'family_annual_income'
          )
      ORDER BY column_name;
    `);
    
    if (results.length > 0) {
      console.log('✅ Migration verification - Columns found:');
      results.forEach(col => {
        console.log(`   - ${col.column_name} (${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}, ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'})`);
      });
    } else {
      console.log('⚠️  No new columns found. They may have already existed.');
    }
    
    console.log('\n✅ Migration process completed!\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run the migration
runMigration();

