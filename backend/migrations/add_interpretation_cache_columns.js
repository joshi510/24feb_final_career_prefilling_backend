/**
 * Adds interpretation_cache_key and cached_at to interpreted_results
 * (required by InterpretedResult model + geminiCache interpretation lookups).
 *
 * Run from backend folder:
 *   node migrations/add_interpretation_cache_columns.js
 */
const { sequelize } = require('../database');
const { QueryTypes } = require('sequelize');

async function columnExists(columnName) {
  const rows = await sequelize.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'interpreted_results'
      AND column_name = :columnName
    LIMIT 1
  `,
    { replacements: { columnName }, type: QueryTypes.SELECT }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function addInterpretationCacheColumns() {
  try {
    console.log('🔵 Migration: add interpretation_cache_key / cached_at to interpreted_results...');

    await sequelize.authenticate();
    console.log('✅ Database connection established');

    if (!(await columnExists('interpretation_cache_key'))) {
      await sequelize.query(`
        ALTER TABLE interpreted_results
        ADD COLUMN interpretation_cache_key VARCHAR(255) NULL
      `);
      await sequelize.query(`
        COMMENT ON COLUMN interpreted_results.interpretation_cache_key IS 'Cache key for interpretation lookups'
      `);
      console.log('✅ Added column interpretation_cache_key');
    } else {
      console.log('ℹ️ Column interpretation_cache_key already exists');
    }

    if (!(await columnExists('cached_at'))) {
      await sequelize.query(`
        ALTER TABLE interpreted_results
        ADD COLUMN cached_at TIMESTAMP WITH TIME ZONE NULL
      `);
      await sequelize.query(`
        COMMENT ON COLUMN interpreted_results.cached_at IS 'Timestamp when interpretation was cached'
      `);
      console.log('✅ Added column cached_at');
    } else {
      console.log('ℹ️ Column cached_at already exists');
    }

    await sequelize.close();
    console.log('✅ Migration finished');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await sequelize.close();
    process.exit(1);
  }
}

addInterpretationCacheColumns();
