const { Sequelize } = require('sequelize');
const config = require('./config');

let sequelize;

// ✅ Production (DATABASE_URL)
if (config.db.url) {
  const dbUrl = config.db.url.replace(/^postgres:\/\//, 'postgresql://');

  sequelize = new Sequelize(dbUrl, {
    dialect: 'postgres',
    logging: config.app.debug ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
} 
// ✅ Local development (PostgreSQL)
else {
  sequelize = new Sequelize(
    config.db.database,
    config.db.user,
    config.db.password,
    {
      host: config.db.host,
      port: config.db.port,   // 5432
      dialect: 'postgres',    // 🔥 FIXED
      logging: config.app.debug ? console.log : false,
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    }
  );
}

// Test connection
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL connection established successfully.');
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to PostgreSQL:', error.message);
    return false;
  }
}

module.exports = { sequelize, testConnection };
