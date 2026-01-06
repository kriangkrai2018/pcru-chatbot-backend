/**
 * Script เพิ่ม synonyms ใหม่
 * - "สามหกห้า" -> "365"
 * - "คอม" -> "คอมพิวเตอร์"
 */

const mysql = require('mysql2/promise');

async function addSynonyms() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    waitForConnections: true,
    connectionLimit: 5
  });

  try {
    // 1. หา KeywordID ของ "365"
    const [rows365] = await pool.query(
      `SELECT KeywordID, KeywordText FROM Keywords WHERE KeywordText = '365' OR KeywordText LIKE '%365%' LIMIT 5`
    );
    console.log('Keywords matching "365":', rows365);

    // 2. หา KeywordID ของ "คอมพิวเตอร์"
    const [rowsComputer] = await pool.query(
      `SELECT KeywordID, KeywordText FROM Keywords WHERE KeywordText LIKE '%คอมพิวเตอร์%' OR KeywordText = 'คอมพิวเตอร์' LIMIT 5`
    );
    console.log('Keywords matching "คอมพิวเตอร์":', rowsComputer);

    // 3. เพิ่ม synonym "สามหกห้า" -> "365" (ถ้ามี keyword 365)
    if (rows365.length > 0) {
      const targetId = rows365[0].KeywordID;
      const [existing] = await pool.query(
        `SELECT SynonymID FROM KeywordSynonyms WHERE InputWord = 'สามหกห้า' AND TargetKeywordID = ?`,
        [targetId]
      );
      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO KeywordSynonyms (InputWord, TargetKeywordID, SimilarityScore, RoleDescription, IsActive) 
           VALUES ('สามหกห้า', ?, 1.0, 'ตัวเลขภาษาไทย', 1)`,
          [targetId]
        );
        console.log(`✅ Added synonym: "สามหกห้า" -> "${rows365[0].KeywordText}"`);
      } else {
        console.log(`⚠️ Synonym "สามหกห้า" already exists`);
      }
    } else {
      console.log('❌ No keyword found for "365"');
    }

    // 4. เพิ่ม synonym "คอม" -> "คอมพิวเตอร์" (ถ้ามี keyword คอมพิวเตอร์)
    if (rowsComputer.length > 0) {
      const targetId = rowsComputer[0].KeywordID;
      const [existing] = await pool.query(
        `SELECT SynonymID FROM KeywordSynonyms WHERE InputWord = 'คอม' AND TargetKeywordID = ?`,
        [targetId]
      );
      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO KeywordSynonyms (InputWord, TargetKeywordID, SimilarityScore, RoleDescription, IsActive) 
           VALUES ('คอม', ?, 1.0, 'คำย่อ', 1)`,
          [targetId]
        );
        console.log(`✅ Added synonym: "คอม" -> "${rowsComputer[0].KeywordText}"`);
      } else {
        console.log(`⚠️ Synonym "คอม" already exists`);
      }
    } else {
      console.log('❌ No keyword found for "คอมพิวเตอร์"');
    }

    // แสดง synonyms ทั้งหมด
    const [allSynonyms] = await pool.query(`
      SELECT s.InputWord, k.KeywordText AS Target 
      FROM KeywordSynonyms s 
      JOIN Keywords k ON s.TargetKeywordID = k.KeywordID 
      WHERE s.IsActive = 1
      ORDER BY s.SynonymID DESC LIMIT 20
    `);
    console.log('\n📋 Current synonyms:', allSynonyms);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

addSynonyms();
