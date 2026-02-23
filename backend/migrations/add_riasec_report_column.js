const { sequelize } = require('../database');
const { QueryTypes } = require('sequelize');

async function addRIASECReportColumn() {
  try {
    console.log('🔵 Starting migration: Add riasec_report column...');
    
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    // Check if column exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'interpreted_results' 
      AND column_name = 'riasec_report'
    `, { type: QueryTypes.SELECT });

    if (results && results.length > 0) {
      console.log('ℹ️ Column riasec_report already exists');
    } else {
      // Add the column
      await sequelize.query(`
        ALTER TABLE interpreted_results 
        ADD COLUMN riasec_report JSON
      `);

      // Add comment
      await sequelize.query(`
        COMMENT ON COLUMN interpreted_results.riasec_report IS 'Cached RIASEC report with scores and report text'
      `);

      console.log('✅ Column riasec_report added successfully');
    }

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await sequelize.close();
    process.exit(1);
  }
}

// Run the migration
addRIASECReportColumn();

