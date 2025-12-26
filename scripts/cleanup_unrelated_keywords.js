/**
 * Script to clean up unrelated keywords from QAs
 * 🛡️ Removes keywords that don't appear in QuestionTitle or QuestionText
 * 
 * Example: keyword "ข่าว" should only be linked to QAs that contain "ข่าว" in title/text
 * 
 * Usage: node scripts/cleanup_unrelated_keywords.js [--dry-run] [--keyword=ข่าว]
 */

const mysql = require('mysql2/promise');
const config = require('../config');

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const keywordArg = args.find(a => a.startsWith('--keyword='));
const targetKeyword = keywordArg ? keywordArg.split('=')[1] : null;

async function main() {
  const pool = mysql.createPool({
    host: config.db?.host || process.env.DB_HOST || 'project.3bbddns.com',
    user: config.db?.user || process.env.DB_USER,
    password: config.db?.password || process.env.DB_PASSWORD,
    database: config.db?.database || process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4'
  });

  try {
    console.log('🧹 Cleaning up unrelated keywords...');
    console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will delete)'}`);
    if (targetKeyword) {
      console.log(`   Target keyword: "${targetKeyword}"`);
    }

    // Find keywords linked to QAs where the keyword doesn't appear in title/text
    let query = `
      SELECT 
        ak.KeywordID,
        ak.QuestionsAnswersID,
        k.KeywordText,
        qa.QuestionTitle,
        qa.QuestionText
      FROM AnswersKeywords ak
      JOIN Keywords k ON ak.KeywordID = k.KeywordID
      JOIN QuestionsAnswers qa ON ak.QuestionsAnswersID = qa.QuestionsAnswersID
      WHERE 1=1
    `;
    
    const params = [];
    if (targetKeyword) {
      query += ` AND LOWER(k.KeywordText) = LOWER(?)`;
      params.push(targetKeyword);
    }

    const [rows] = await pool.query(query, params);

    console.log(`\n📊 Found ${rows.length} keyword-QA links to check`);

    let deletedCount = 0;
    let keptCount = 0;
    const toDelete = [];

    for (const row of rows) {
      const keyword = row.KeywordText.toLowerCase();
      const title = (row.QuestionTitle || '').toLowerCase();
      const text = (row.QuestionText || '').toLowerCase();

      // Check if keyword appears in title or text
      const inTitle = title.includes(keyword);
      const inText = text.includes(keyword);

      if (!inTitle && !inText) {
        toDelete.push({
          keywordId: row.KeywordID,
          qaId: row.QuestionsAnswersID,
          keyword: row.KeywordText,
          title: row.QuestionTitle
        });
        console.log(`❌ UNRELATED: "${row.KeywordText}" ↔ QA#${row.QuestionsAnswersID} "${row.QuestionTitle.substring(0, 40)}..."`);
      } else {
        keptCount++;
        // console.log(`✅ KEEP: "${row.KeywordText}" ↔ QA#${row.QuestionsAnswersID}`);
      }
    }

    console.log(`\n📈 Summary:`);
    console.log(`   - To delete: ${toDelete.length}`);
    console.log(`   - To keep: ${keptCount}`);

    if (toDelete.length > 0 && !dryRun) {
      console.log(`\n🗑️ Deleting ${toDelete.length} unrelated keyword links...`);
      
      for (const item of toDelete) {
        await pool.query(
          `DELETE FROM AnswersKeywords WHERE KeywordID = ? AND QuestionsAnswersID = ?`,
          [item.keywordId, item.qaId]
        );
        deletedCount++;
      }
      
      console.log(`✅ Deleted ${deletedCount} unrelated keyword links`);
    } else if (toDelete.length > 0) {
      console.log(`\n⚠️ DRY RUN: Would delete ${toDelete.length} unrelated keyword links`);
      console.log(`   Run without --dry-run to actually delete`);
    } else {
      console.log(`\n✅ No unrelated keywords found!`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
