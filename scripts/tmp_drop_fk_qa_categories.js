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
    await conn.query("ALTER TABLE QuestionsAnswers DROP FOREIGN KEY fk_qa_categories");
    console.log('Dropped foreign key fk_qa_categories');
  }catch(e){
    console.error('Error dropping fk:', e.message || e);
  }
  const [rows]=await conn.query("SELECT constraint_name, table_name, column_name, referenced_table_name FROM information_schema.key_column_usage WHERE constraint_schema=database() AND (table_name='QuestionsAnswers' OR LOWER(referenced_table_name) LIKE 'categories%')");
  console.log(rows);
  await conn.end();
})();