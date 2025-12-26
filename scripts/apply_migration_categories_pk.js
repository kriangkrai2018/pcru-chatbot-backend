const fs = require('fs');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function runSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    multipleStatements: true
  });
  try {
    for (const stmt of statements) {
      console.log('Executing:', stmt.split('\n')[0]);
      await conn.query(stmt);
    }
    console.log('Migration applied successfully.');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  const file = process.argv[2] || 'database/migrations/2025-12-22_add_categories_pk.up.sql';
  console.log('Applying migration from', file);
  runSqlFile(file).catch(e=>{ console.error(e); process.exit(1); });
}

module.exports = runSqlFile;