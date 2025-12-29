// services/QuestionsAnswers/autoExportCSV.js
// Auto-export QuestionsAnswers to CSV whenever data changes

const fs = require('fs').promises;
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

/**
 * Auto-export all QuestionsAnswers to CSV
 * This runs automatically after any data change (upload/edit/delete)
 * 
 * @param {Pool} pool - MySQL connection pool
 * @param {number} officerId - Officer ID for file organization
 * @returns {Promise<string>} - Path to exported CSV file
 */
async function autoExportQuestionsAnswersCSV(pool, officerId = 3001) {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    // 1. Fetch all Q&As with their keywords and categories
    const query = `
      SELECT 
        qa.QuestionsAnswersID,
        qa.QuestionTitle,
        qa.QuestionText,
        qa.ReviewDate,
        qa.OfficerID,
        qa.CategoriesID,
        c.CategoriesName,
        GROUP_CONCAT(DISTINCT k.KeywordText ORDER BY k.KeywordText SEPARATOR ', ') as Keywords
      FROM QuestionsAnswers qa
      LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
      LEFT JOIN AnswersKeywords ak ON qa.QuestionsAnswersID = ak.QuestionsAnswersID
      LEFT JOIN Keywords k ON ak.KeywordID = k.KeywordID
      WHERE qa.OfficerID = ?
      GROUP BY qa.QuestionsAnswersID
      ORDER BY qa.QuestionsAnswersID ASC
    `;
    
    const [rows] = await connection.query(query, [officerId]);
    
    if (rows.length === 0) {
      console.log('⚠️  No Q&As to export');
      return null;
    }
    
    // 2. Prepare export directory
    const exportDir = path.join(__dirname, '../../files/managequestionsanswers', String(officerId));
    await fs.mkdir(exportDir, { recursive: true });
    
    // 3. Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `questionsanswers_${timestamp}.csv`;
    const filepath = path.join(exportDir, filename);
    
    // 4. Create CSV writer with UTF-8 BOM for Excel compatibility
    const csvWriter = createObjectCsvWriter({
      path: filepath,
      header: [
        { id: 'QuestionTitle', title: 'QuestionTitle' },
        { id: 'ReviewDate', title: 'ReviewDate' },
        { id: 'Keywords', title: 'Keywords' },
        { id: 'CategoriesID', title: 'CategoriesID' },
        { id: 'QuestionText', title: 'QuestionText' }
      ],
      encoding: 'utf8',
      append: false,
      alwaysQuote: true
    });
    
    // 5. Prepare data for export
    const exportData = rows.map(row => ({
      QuestionTitle: row.QuestionTitle || '',
      ReviewDate: row.ReviewDate ? new Date(row.ReviewDate).toISOString().split('T')[0] : '',
      Keywords: row.Keywords || '',
      CategoriesID: row.CategoriesName || '',
      QuestionText: row.QuestionText || ''
    }));
    
    // 6. Write CSV with UTF-8 BOM
    await csvWriter.writeRecords(exportData);
    
    // Prepend UTF-8 BOM (EF BB BF) for Excel compatibility
    const content = await fs.readFile(filepath);
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    const withBom = Buffer.concat([bom, content]);
    await fs.writeFile(filepath, withBom);
    
    // 7. Create symlink to "latest" for easy access
    const latestPath = path.join(exportDir, 'latest.csv');
    try {
      await fs.unlink(latestPath);
    } catch (e) {
      // File doesn't exist, ignore
    }
    
    try {
      await fs.symlink(filename, latestPath);
    } catch (e) {
      // Symlink failed, copy instead
      await fs.copyFile(filepath, latestPath);
    }
    
    console.log(`✅ Auto-exported ${rows.length} Q&As to: ${filepath}`);
    console.log(`📄 Latest CSV available at: ${latestPath}`);
    
    return filepath;
    
  } catch (error) {
    console.error('❌ Auto-export CSV failed:', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

/**
 * Get the latest exported CSV file path
 * 
 * @param {number} officerId - Officer ID
 * @returns {Promise<string|null>} - Path to latest CSV or null
 */
async function getLatestExportedCSV(officerId = 3001) {
  const exportDir = path.join(__dirname, '../../files/managequestionsanswers', String(officerId));
  const latestPath = path.join(exportDir, 'latest.csv');
  
  try {
    await fs.access(latestPath);
    return latestPath;
  } catch (e) {
    return null;
  }
}

module.exports = {
  autoExportQuestionsAnswersCSV,
  getLatestExportedCSV
};
