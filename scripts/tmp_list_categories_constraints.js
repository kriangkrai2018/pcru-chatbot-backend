const mysql = require('mysql2/promise');
require('dotenv').config();

(async ()=>{
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response'
  });
  const [rows] = await conn.query(`SELECT constraint_name, table_name, column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE constraint_schema=database() AND (LOWER(table_name) LIKE 'categories%' OR LOWER(referenced_table_name) LIKE 'categories%') ORDER BY table_name`);
  console.log(rows);
  await conn.end();
})();