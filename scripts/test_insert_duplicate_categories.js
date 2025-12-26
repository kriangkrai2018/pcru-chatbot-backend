const mysql = require('mysql2/promise');
require('dotenv').config();

(async ()=>{
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response'
  });
  try {
    console.log('Inserting two categories with same CategoriesID: TEST-1');
    await conn.query("INSERT INTO Categories (CategoriesID, CategoriesName, ParentCategoriesID, OfficerID) VALUES (?, ?, ?, ?)", ['TEST-1', 'Test Category A', null, null]);
    await conn.query("INSERT INTO Categories (CategoriesID, CategoriesName, ParentCategoriesID, OfficerID) VALUES (?, ?, ?, ?)", ['TEST-1', 'Test Category B', null, null]);
    const [rows] = await conn.query("SELECT CategoriesID, COUNT(*) as c FROM Categories WHERE CategoriesID = ? GROUP BY CategoriesID", ['TEST-1']);
    console.log('Result:', rows);
  } catch (e) {
    console.error('Test failed:', e.message || e);
  } finally {
    await conn.end();
  }
})();