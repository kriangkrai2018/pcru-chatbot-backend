/**
 * Script to sync standard Thai stopwords to the database
 * Uses a curated list based on PyThaiNLP standard stopwords (trusted 100%)
 * 
 * Usage:
 *   node scripts/sync_stopwords_from_standard.js
 */

const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Standard Thai stopwords list (based on PyThaiNLP corpus - most trusted source)
// This list is carefully curated and represents words that are 100% filler/function words
const STANDARD_THAI_STOPWORDS = [
  // Conjunctions & connectors
  'และ', 'หรือ', 'แต่', 'แล้ว', 'ก็', 'จึง', 'ดังนั้น', 'เพราะ', 'เนื่องจาก',
  'เพื่อ', 'โดย', 'ซึ่ง', 'อัน', 'ที่', 'ว่า', 'คือ',
  
  // Particles & polite words
  'ครับ', 'ค่ะ', 'คะ', 'จ้า', 'จ๊ะ', 'นะ', 'ละ', 'หรอ', 'เหรอ', 'หนอ',
  'เถิด', 'เถอะ', 'สิ', 'ซิ',
  
  // Common verbs (high frequency, low semantic value)
  'เป็น', 'มี', 'ได้', 'คือ', 'อยู่', 'ไป', 'มา', 'ให้', 'ถึง', 'จาก',
  'กับ', 'แก่', 'แด่', 'ของ', 'ใน', 'ที่', 'ซึ่ง', 'อัน',
  
  // Negations & modifiers (common but low info)
  'ไม่', 'ไม่ได้', 'ไม่ใช่', 'มิ', 'มิได้',
  
  // Question words (context-dependent)
  'อะไร', 'ไหน', 'เมื่อไร', 'อย่างไร', 'ทำไม', 'ใช่ไหม',
  
  // Demonstratives & pronouns (high frequency)
  'นี้', 'นั้น', 'นั่น', 'โน้น', 'เหล่านี้', 'เหล่านั้น',
  'ฉัน', 'ผม', 'ดิฉัน', 'เรา', 'เขา', 'เธอ', 'มัน', 'ท่าน', 'คุณ',
  
  // Quantifiers & determiners
  'ทุก', 'หลาย', 'บาง', 'บางส่วน', 'ทั้ง', 'ทั้งหมด', 'ส่วนใหญ่',
  'แต่ละ', 'อีก', 'อื่น', 'อื่นๆ',
  
  // Prepositions
  'ใน', 'ที่', 'จาก', 'ถึง', 'ไปยัง', 'ต่อ', 'เกี่ยวกับ', 'ระหว่าง',
  'ตาม', 'ตั้งแต่', 'จนถึง', 'ภายใน', 'ภายนอก', 'ข้างใน', 'ข้างนอก',
  
  // Auxiliary/helping words
  'จะ', 'ได้', 'กำลัง', 'อยาก', 'ต้อง', 'ควร', 'ต้องการ', 'จำเป็น',
  
  // Time/aspect markers (generic)
  'เคย', 'เมื่อ', 'ตอน', 'ขณะ', 'เวลา', 'ครั้ง', 'คราว',
  
  // Degree/emphasis (generic)
  'มาก', 'น้อย', 'เล็กน้อย', 'ค่อนข้าง', 'ค่อย', 'ยิ่ง', 'เกิน',
  'พอ', 'เพียง', 'แค่', 'เท่านั้น', 'เพียงแต่', 'เลย'
];

async function syncStopwords(externalPool = null) {
  let connection;
  let isExternalPool = !!externalPool;
  try {
    console.log('🔄 Starting stopwords sync from standard list...');
    
    // Use external pool if provided, otherwise create a new connection
    if (externalPool) {
      connection = await externalPool.getConnection();
    } else {
      connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        charset: 'utf8mb4'
      });
    }

    console.log('✅ Connected to database');

    // Get existing stopwords
    const [existing] = await connection.query(
      'SELECT StopwordText FROM Stopwords'
    );
    const existingSet = new Set(existing.map(row => row.StopwordText));

    console.log(`📊 Found ${existingSet.size} existing stopwords in database`);

    // Get negative keywords to avoid duplicates
    const [negRows] = await connection.query("SELECT Word FROM NegativeKeywords WHERE IsActive = 1");
    const negativeKeywordsSet = new Set(negRows.map(r => r.Word.toLowerCase()));
    console.log(`🚫 Found ${negativeKeywordsSet.size} active negative keywords`);

    // Load previously removed stopwords to avoid re-adding them
    let removedStopwordsSet = new Set();
    try {
      const removedData = JSON.parse(fs.readFileSync('nonstandard_stopwords_report.json', 'utf8'));
      if (removedData.all) {
        removedStopwordsSet = new Set(removedData.all.map(w => w.toLowerCase()));
      }
      console.log(`🗑️ Found ${removedStopwordsSet.size} previously removed stopwords`);
    } catch (e) {
      console.log('ℹ️ No removed stopwords file found, proceeding without it');
    }

    // Prepare new stopwords to insert (exclude existing, negative keywords, and removed)
    const newStopwords = STANDARD_THAI_STOPWORDS.filter(word => 
      !existingSet.has(word) && 
      !negativeKeywordsSet.has(word.toLowerCase()) && 
      !removedStopwordsSet.has(word.toLowerCase())
    );

    if (newStopwords.length === 0) {
      console.log('✅ All standard stopwords already exist in database. Nothing to add.');
    } else {
      console.log(`➕ Adding ${newStopwords.length} new standard stopwords...`);
      
      // Batch insert
      const values = newStopwords.map(word => [word]);
      await connection.query(
        'INSERT IGNORE INTO Stopwords (StopwordText) VALUES ?',
        [values]
      );

      console.log('✅ Successfully added new stopwords');
    }

    // Optional: Remove or export stopwords that are NOT in the standard list
    const nonStandardWords = [...existingSet].filter(word => !STANDARD_THAI_STOPWORDS.includes(word));

    // CLI options: --export <file> to dump non-standard words, --prune to delete them
    const args = process.argv.slice(2);
    let exportFile = null;
    const exportIndex = args.indexOf('--export');
    if (exportIndex !== -1) {
      exportFile = args[exportIndex + 1] || 'nonstandard_stopwords_report.json';
    }
    const doPrune = args.includes('--prune');
    const pruneConfirm = process.env.PRUNE_CONFIRM === 'true';

    if (nonStandardWords.length > 0) {
      console.log(`⚠️  Warning: Found ${nonStandardWords.length} non-standard stopwords in database:`);
      console.log('   ', nonStandardWords.slice(0, 10).join(', '), nonStandardWords.length > 10 ? '...' : '');
      console.log('   You may want to review and remove these manually if needed.');

      if (exportFile) {
        try {
          const report = {
            generatedAt: new Date().toISOString(),
            count: nonStandardWords.length,
            sample: nonStandardWords.slice(0, 50),
            all: nonStandardWords
          };
          fs.writeFileSync(exportFile, JSON.stringify(report, null, 2), 'utf8');
          console.log(`✅ Exported non-standard stopwords to ${exportFile}`);
        } catch (e) {
          console.warn('⚠️  Could not write export file:', e && e.message);
        }
      }

      if (doPrune) {
        if (!pruneConfirm) {
          console.warn('⚠️  Prune requested but PRUNE_CONFIRM is not set to true. Aborting deletion.');
        } else {
          try {
            const placeholders = nonStandardWords.map(() => '?').join(',');
            await connection.query(`DELETE FROM Stopwords WHERE StopwordText IN (${placeholders})`, nonStandardWords);
            console.log(`🗑️  Deleted ${nonStandardWords.length} non-standard stopwords from database`);
          } catch (delErr) {
            console.error('❌ Failed to delete non-standard stopwords:', delErr && delErr.message);
          }
        }
      }
    }

    // Summary
    const [final] = await connection.query('SELECT COUNT(*) as count FROM Stopwords');
    console.log(`\n📊 Final count: ${final[0].count} stopwords in database`);
    console.log('✅ Sync completed successfully!');
    
  } catch (error) {
    console.error('❌ Error syncing stopwords:', error);
    if (!isExternalPool) process.exit(1);
    throw error; // Re-throw if using external pool (for server startup)
  } finally {
    if (connection && !isExternalPool) {
      await connection.end();
    } else if (connection && isExternalPool) {
      connection.release(); // Release back to pool
    }
  }
}

// Run if executed directly
if (require.main === module) {
  syncStopwords()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { syncStopwords, STANDARD_THAI_STOPWORDS };
