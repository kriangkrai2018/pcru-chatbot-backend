/**
 * API endpoints for cleaning up keywords in QA Management
 * Allows admins to remove unwanted keywords from QAs
 */

const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
const config = require('../config');

/**
 * GET /keywords/suggestions/:qaId
 * Get keyword suggestions that could be removed from a QA
 * Shows all keywords with frequency analysis
 */
router.get('/suggestions/:qaId', async (req, res) => {
  const { qaId } = req.params;
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 5
  });

  try {
    // Get QA details
    const [qas] = await pool.query(
      'SELECT QuestionsAnswersID, QuestionTitle FROM QuestionsAnswers WHERE QuestionsAnswersID = ?',
      [qaId]
    );

    if (qas.length === 0) {
      return res.status(404).json({ error: 'QA not found' });
    }

    const qa = qas[0];

    // Get all keywords for this QA
    const [keywords] = await pool.query(`
      SELECT k.KeywordID, k.KeywordText
      FROM AnswersKeywords ak
      JOIN Keywords k ON ak.KeywordID = k.KeywordID
      WHERE ak.QuestionsAnswersID = ?
      ORDER BY k.KeywordText
    `, [qaId]);

    // Categorize keywords as related or outlier
    const relatedKeywords = [];
    const outlierKeywords = [];

    for (const kw of keywords) {
      const kwLower = kw.KeywordText.toLowerCase();
      const titleLower = qa.QuestionTitle.toLowerCase();
      
      // If keyword appears in title, it's related
      if (titleLower.includes(kwLower)) {
        relatedKeywords.push({
          id: kw.KeywordID,
          text: kw.KeywordText,
          status: 'related'
        });
      } else {
        outlierKeywords.push({
          id: kw.KeywordID,
          text: kw.KeywordText,
          status: 'outlier'
        });
      }
    }

    // --- NEW: also fetch stopwords that appear in the QA title or match keyword texts ---
    const stopwordsMap = new Map();
    try {
      // Stopwords appearing in the question title
      const [stopwordsInTitle] = await pool.query(
        `SELECT StopwordID, StopwordText FROM Stopwords WHERE LOWER(?) LIKE CONCAT('%', LOWER(StopwordText), '%')`,
        [qa.QuestionTitle || '']
      );
      for (const sw of stopwordsInTitle) {
        const key = (sw.StopwordText || '').toLowerCase();
        if (!stopwordsMap.has(key)) stopwordsMap.set(key, { id: sw.StopwordID, text: sw.StopwordText, source: ['title'] });
        else stopwordsMap.get(key).source.push('title');
      }

      // Stopwords that match any keyword text
      const keywordTextsLower = keywords.map(k => (k.KeywordText || '').toLowerCase()).filter(Boolean);
      if (keywordTextsLower.length > 0) {
        const placeholders = keywordTextsLower.map(() => '?').join(',');
        const [stopwordsMatchingKeywords] = await pool.query(
          `SELECT StopwordID, StopwordText FROM Stopwords WHERE LOWER(StopwordText) IN (${placeholders})`,
          keywordTextsLower
        );

        for (const sw of stopwordsMatchingKeywords) {
          const key = (sw.StopwordText || '').toLowerCase();
          if (!stopwordsMap.has(key)) stopwordsMap.set(key, { id: sw.StopwordID, text: sw.StopwordText, source: ['keyword'] });
          else if (!stopwordsMap.get(key).source.includes('keyword')) stopwordsMap.get(key).source.push('keyword');
        }
      }
    } catch (e) {
      console.error('Error fetching related stopwords:', e && e.message);
    }

    const stopwords = Array.from(stopwordsMap.values()).map(s => ({ id: s.id, text: s.text, source: s.source }));

    // Compose a friendly suggestion message including both outliers and stopwords
    const suggestionsParts = [];
    if (outlierKeywords.length > 0) suggestionsParts.push(`${outlierKeywords.length} outlier keyword${outlierKeywords.length > 1 ? 's' : ''}`);
    if (stopwords.length > 0) suggestionsParts.push(`${stopwords.length} stopword${stopwords.length > 1 ? 's' : ''}`);
    const composedSuggestion = suggestionsParts.length > 0 ? `Consider removing ${suggestionsParts.join(' and ')}` : 'No obvious issues detected';

    res.json({
      qaId,
      questionTitle: qa.QuestionTitle,
      totalKeywords: keywords.length,
      relatedKeywords,
      outlierKeywords,
      stopwords,
      totalStopwords: stopwords.length,
      suggestion: composedSuggestion
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await pool.end();
  }
});

/**
 * DELETE /keywords/remove
 * Remove specific keywords from a QA
 * Body: { qaId, keywordIds: [1, 2, 3] }
 */
router.delete('/remove', async (req, res) => {
  const { qaId, keywordIds } = req.body;

  if (!qaId || !Array.isArray(keywordIds) || keywordIds.length === 0) {
    return res.status(400).json({ error: 'Missing qaId or keywordIds' });
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 5
  });

  try {
    // Remove keywords
    const placeholders = keywordIds.map(() => '?').join(',');
    await pool.query(
      `DELETE FROM AnswersKeywords WHERE QuestionsAnswersID = ? AND KeywordID IN (${placeholders})`,
      [qaId, ...keywordIds]
    );

    res.json({
      success: true,
      message: `Removed ${keywordIds.length} keywords from QA#${qaId}`,
      removedCount: keywordIds.length
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await pool.end();
  }
});

/**
 * DELETE /keywords/bulkRemoveOutliers
 * Remove all outlier keywords from a QA (keywords not appearing in title)
 * Body: { qaId }
 */
router.delete('/bulkRemoveOutliers', async (req, res) => {
  const { qaId } = req.body;

  if (!qaId) {
    return res.status(400).json({ error: 'Missing qaId' });
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 5
  });

  try {
    // Get QA title
    const [qas] = await pool.query(
      'SELECT QuestionTitle FROM QuestionsAnswers WHERE QuestionsAnswersID = ?',
      [qaId]
    );

    if (qas.length === 0) {
      return res.status(404).json({ error: 'QA not found' });
    }

    const qa = qas[0];
    const titleLower = qa.QuestionTitle.toLowerCase();

    // Get all keywords for this QA
    const [keywords] = await pool.query(`
      SELECT k.KeywordID, k.KeywordText
      FROM AnswersKeywords ak
      JOIN Keywords k ON ak.KeywordID = k.KeywordID
      WHERE ak.QuestionsAnswersID = ?
    `, [qaId]);

    // Find outliers (keywords not in title)
    const outlierIds = [];
    for (const kw of keywords) {
      if (!titleLower.includes(kw.KeywordText.toLowerCase())) {
        outlierIds.push(kw.KeywordID);
      }
    }

    if (outlierIds.length === 0) {
      return res.json({
        success: true,
        message: 'No outlier keywords to remove',
        removedCount: 0
      });
    }

    // Remove outlier keywords
    const placeholders = outlierIds.map(() => '?').join(',');
    await pool.query(
      `DELETE FROM AnswersKeywords WHERE QuestionsAnswersID = ? AND KeywordID IN (${placeholders})`,
      [qaId, ...outlierIds]
    );

    res.json({
      success: true,
      message: `Removed ${outlierIds.length} outlier keywords from QA#${qaId}`,
      removedCount: outlierIds.length
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    await pool.end();
  }
});


// GET /keywords/insights?keyword=...
router.get('/insights', async (req, res) => {
  const keyword = (req.query.keyword || '').toString().trim();
  if (!keyword) return res.status(400).json({ error: 'Missing keyword query param' });

  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 5
  });

  try {
    const kwLower = keyword.toLowerCase();

    // 1) Trends (last 30 days) - counts per day from ChatLogHasAnswers + ChatLogNoAnswers
    const [trendRows] = await pool.query(
      `SELECT DATE(t.Timestamp) AS day, COUNT(*) AS cnt FROM (
         SELECT Timestamp, UserQuery FROM ChatLogHasAnswers
         UNION ALL
         SELECT Timestamp, UserQuery FROM ChatLogNoAnswers
       ) t
       WHERE LOWER(t.UserQuery) LIKE ? AND t.Timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(t.Timestamp) ORDER BY DATE(t.Timestamp) ASC`,
      [`%${kwLower}%`]
    );

    // 2) Latest searches (mix of has and no answers)
    const [hasRows] = await pool.query(
      `SELECT ChatLogID, Timestamp, UserQuery, QuestionsAnswersID, 'has' as type FROM ChatLogHasAnswers WHERE LOWER(UserQuery) LIKE ? ORDER BY Timestamp DESC LIMIT 30`,
      [`%${kwLower}%`]
    );

    const [noRows] = await pool.query(
      `SELECT ChatLogID, Timestamp, UserQuery, NULL as QuestionsAnswersID, 'no' as type FROM ChatLogNoAnswers WHERE LOWER(UserQuery) LIKE ? ORDER BY Timestamp DESC LIMIT 30`,
      [`%${kwLower}%`]
    );

    // Merge and sort by Timestamp desc and limit 40
    const merged = [...hasRows, ...noRows].sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp)).slice(0, 40);

    // 3) Related QAs: prefer explicit keyword link (AnswersKeywords). If none found, fallback to textual match
    // First, try to find a Keyword record for exact match
    const [kwRows] = await pool.query('SELECT KeywordID FROM Keywords WHERE LOWER(KeywordText) = ? LIMIT 1', [kwLower]);
    let qaRows = [];

    if (kwRows && kwRows.length > 0) {
      const keywordId = kwRows[0].KeywordID;
      const [linked] = await pool.query(
        `SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.QuestionText AS QuestionText, qa.CategoriesID
         FROM QuestionsAnswers qa
         INNER JOIN AnswersKeywords ak ON ak.QuestionsAnswersID = qa.QuestionsAnswersID
         WHERE ak.KeywordID = ?
         LIMIT 100`,
        [keywordId]
      );
      qaRows = linked || [];
    }

    // If no explicit linked QAs found, fallback to textual search
    if (!qaRows || qaRows.length === 0) {
      const [textMatches] = await pool.query(
        `SELECT DISTINCT qa.QuestionsAnswersID, qa.QuestionTitle, qa.QuestionText AS QuestionText, qa.CategoriesID
         FROM QuestionsAnswers qa
         WHERE LOWER(qa.QuestionTitle) LIKE ?
           OR LOWER(qa.QuestionText) LIKE ?
         LIMIT 100`,
        [`%${kwLower}%`, `%${kwLower}%`]
      );
      qaRows = textMatches || [];
    }

    res.json({
      keyword: keyword,
      trends: trendRows || [],
      latestSearches: merged,
      relatedQAs: qaRows || []
    });
  } catch (error) {
    console.error('Error fetching keyword insights:', error);
    if (error && /No database selected/i.test(String(error.message || ''))) {
      console.error('❌ Missing DB configuration: DB_NAME currently:', process.env.DB_NAME || '(unset)');
    }
    res.status(500).json({ error: error.message });
  } finally {
    await pool.end();
  }
});

module.exports = router;
