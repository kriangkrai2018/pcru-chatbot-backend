const mysql = require('mysql2/promise');
require('dotenv').config();

(async ()=>{
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response'
  });
  // create backups if not exist
  await conn.query("CREATE TABLE IF NOT EXISTS Backup_Categories LIKE Categories");
  await conn.query("TRUNCATE TABLE Backup_Categories");
  await conn.query("INSERT INTO Backup_Categories SELECT * FROM Categories");

  await conn.query("CREATE TABLE IF NOT EXISTS Backup_QuestionsAnswers LIKE QuestionsAnswers");
  await conn.query("TRUNCATE TABLE Backup_QuestionsAnswers");
  await conn.query("INSERT INTO Backup_QuestionsAnswers SELECT * FROM QuestionsAnswers");

  await conn.query("CREATE TABLE IF NOT EXISTS Backup_Categories_old_20251222 LIKE Categories_old_20251222");
  await conn.query("TRUNCATE TABLE Backup_Categories_old_20251222");
  await conn.query("INSERT INTO Backup_Categories_old_20251222 SELECT * FROM Categories_old_20251222");

  console.log('Backups created: Backup_Categories, Backup_QuestionsAnswers, Backup_Categories_old_20251222');
  await conn.end();
})();