const mysql = require('mysql2/promise');
require('dotenv').config();

(async ()=>{
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response'
  });
  try{
    await conn.query('DROP TABLE IF EXISTS Categories_old_20251222');
    console.log('Dropped Categories_old_20251222');
  }catch(e){
    console.error('Error dropping table:', e.message||e);
  }
  const [tables]=await conn.query("SHOW TABLES LIKE 'Categories%'");
  console.log('Remaining tables:', tables);
  await conn.end();
})();