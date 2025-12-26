const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

async function deleteStopword() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    charset: 'utf8mb4'
  });

  try {
    const [result] = await pool.query(
      `DELETE FROM Stopwords WHERE StopwordText = ?`,
      ['ไม่เอา']
    );

    if (result.affectedRows > 0) {
      console.log('✅ Successfully deleted stopword: ไม่เอา');
    } else {
      console.log('⚠️ Stopword "ไม่เอา" not found');
    }
  } catch (error) {
    console.error('❌ Error deleting stopword:', error);
  } finally {
    await pool.end();
  }
}

deleteStopword();