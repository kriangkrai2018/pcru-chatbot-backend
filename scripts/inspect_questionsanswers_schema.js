const mysql = require('mysql2/promise');
require('dotenv').config();

(async ()=>{
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response'
  });
  const [rows] = await conn.query("SHOW CREATE TABLE QuestionsAnswers");
  console.log(rows[0]);
  await conn.end();
})();