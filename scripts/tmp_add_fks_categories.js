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
    await conn.query(`ALTER TABLE Categories
      ADD CONSTRAINT fk_categories_parent_revert FOREIGN KEY (ParentCategoriesID) REFERENCES Categories(CategoriesID) ON DELETE SET NULL ON UPDATE CASCADE`);
    console.log('Added fk_categories_parent_revert');
  }catch(e){console.error('Error adding parent fk:', e.message||e);}
  try{
    await conn.query(`ALTER TABLE Categories
      ADD CONSTRAINT fk_categories_officer_revert FOREIGN KEY (OfficerID) REFERENCES Officers(OfficerID) ON DELETE SET NULL ON UPDATE CASCADE`);
    console.log('Added fk_categories_officer_revert');
  }catch(e){console.error('Error adding officer fk:', e.message||e);}

  const [rows]=await conn.query("SELECT constraint_name, table_name, column_name, referenced_table_name FROM information_schema.key_column_usage WHERE constraint_schema=database() AND (table_name='Categories' OR referenced_table_name='Categories')");
  console.log(rows);
  await conn.end();
})();