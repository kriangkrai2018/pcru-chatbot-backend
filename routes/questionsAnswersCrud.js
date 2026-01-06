/**
 * QuestionsAnswers CRUD API
 * เพิ่ม, แก้ไข, ลบ คำถาม-คำตอบ แบบง่ายๆ
 */

const express = require('express');
const router = express.Router();
const { autoExportQuestionsAnswersCSV } = require('../services/QuestionsAnswers/autoExportCSV');
const ensureKeyword = require('../services/QuestionsAnswers/ensureKeyword');
const { clearStopwordsCache } = require('../services/stopwords/loadStopwords');
const cleanupUnusedKeywords = require('../services/QuestionsAnswers/cleanupUnusedKeywords');

// Helper: export latest CSV but never block the request
async function exportLatestCSV(pool, officerId) {
  if (!pool) return;
  try {
    const exporterId = officerId || undefined;
    await autoExportQuestionsAnswersCSV(pool, exporterId);
    console.log('✅ Auto-exported CSV after QA change');
  } catch (err) {
    console.warn('⚠️ Auto-export failed (non-fatal):', err.message || err);
  }
}

/**
 * Middleware to get pool from app.locals
 */
router.use((req, res, next) => {
  if (!req.pool && req.app.locals && req.app.locals.pool) {
    req.pool = req.app.locals.pool;
  }
  next();
});

/**
 * POST /questionsanswers/create
 * เพิ่มคำถาม-คำตอบใหม่
 */
router.post('/create', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const { questionTitle, questionText, reviewDate, categoriesId, keywords } = req.body;

  if (!questionTitle || !questionText) {
    return res.status(400).json({ success: false, message: 'questionTitle และ questionText จำเป็นต้องระบุ' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Use provided reviewDate or default to NOW()
    const finalReviewDate = reviewDate || new Date().toISOString().slice(0, 10);

    // 1. Insert QuestionsAnswers
    const [result] = await connection.query(
      `INSERT INTO QuestionsAnswers (QuestionTitle, QuestionText, CategoriesID, ReviewDate, OfficerID) 
       VALUES (?, ?, ?, ?, ?)`,
      [questionTitle.trim(), questionText.trim(), categoriesId || null, finalReviewDate, req.user?.userId || null]
    );

    const newQaId = result.insertId;

    // 2. Add keywords if provided
    const skippedKeywords = [];
    if (keywords && Array.isArray(keywords) && keywords.length > 0) {
      const seenKeywords = new Set(); // normalize inside request to prevent double counting

      for (const keyword of keywords) {
        const kw = String(keyword || '').trim();
        if (!kw) continue;

        const norm = kw.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!norm || seenKeywords.has(norm)) continue;
        seenKeywords.add(norm);

        const kwRes = await ensureKeyword(connection, kw, req.user?.userId);
        const keywordId = kwRes && kwRes.keywordId ? kwRes.keywordId : null;
        if (!keywordId) {
          skippedKeywords.push(kw);
          continue;
        }

        await connection.query(
          'INSERT IGNORE INTO AnswersKeywords (QuestionsAnswersID, KeywordID) VALUES (?, ?)',
          [newQaId, keywordId]
        );
      }
    }

    await connection.commit();

    // Clear stopwords cache when keywords may have changed
    clearStopwordsCache();

    // Notify WebSocket clients
    if (req.app.locals.notifyQuestionsAnswersUpdate) {
      req.app.locals.notifyQuestionsAnswersUpdate({ action: 'create', id: newQaId });
    }

    // Export latest CSV in background
    exportLatestCSV(pool, req.user?.officerId || req.user?.userId).catch(() => {});

    // Build response message
    let message = 'เพิ่มคำถาม-คำตอบสำเร็จ';
    if (skippedKeywords.length > 0) {
      message += ` (ข้ามคำสำคัญ: ${skippedKeywords.join(', ')})`;
    }

    res.status(201).json({
      success: true,
      message: message,
      data: { id: newQaId },
      skippedKeywords: skippedKeywords.length > 0 ? skippedKeywords : undefined
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Create QA error:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * PUT /questionsanswers/update/:id
 * แก้ไขคำถาม-คำตอบ
 */
router.put('/update/:id', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const qaId = parseInt(req.params.id);
  const { questionTitle, questionText, reviewDate, categoriesId, keywords } = req.body;

  if (!qaId || isNaN(qaId)) {
    return res.status(400).json({ success: false, message: 'Invalid QA ID' });
  }

  console.log('Update request:', { qaId, questionTitle, questionText, reviewDate, categoriesId });

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Update QuestionsAnswers
    const updateFields = [];
    const updateValues = [];

    if (questionTitle !== undefined && questionTitle !== null) {
      updateFields.push('QuestionTitle = ?');
      updateValues.push(questionTitle.trim());
    }
    if (questionText !== undefined && questionText !== null) {
      updateFields.push('QuestionText = ?');
      updateValues.push(questionText.trim());
    }
    if (reviewDate !== undefined && reviewDate !== null) {
      updateFields.push('ReviewDate = ?');
      updateValues.push(reviewDate);
      console.log('Adding ReviewDate to update:', reviewDate);
    }
    if (categoriesId !== undefined && categoriesId !== null) {
      updateFields.push('CategoriesID = ?');
      updateValues.push(categoriesId);
    }

    updateValues.push(qaId);

    if (updateFields.length > 0) {
      const sqlQuery = `UPDATE QuestionsAnswers SET ${updateFields.join(', ')} WHERE QuestionsAnswersID = ?`;
      console.log('SQL Query:', sqlQuery);
      console.log('Update values:', updateValues);
      
      const [result] = await connection.query(sqlQuery, updateValues);
      console.log('Update result - affected rows:', result.affectedRows);
    } else {
      console.log('⚠️ No fields to update!');
    }

    // 2. Update keywords if provided
    const skippedKeywords = [];
    if (keywords !== undefined && Array.isArray(keywords)) {
      // Remove existing keywords
      await connection.query(
        'DELETE FROM AnswersKeywords WHERE QuestionsAnswersID = ?',
        [qaId]
      );

      const seenKeywords = new Set();

      // Add new keywords
      for (const keyword of keywords) {
        const kw = String(keyword || '').trim();
        if (!kw) continue;

        const norm = kw.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!norm || seenKeywords.has(norm)) continue;
        seenKeywords.add(norm);

        const kwRes = await ensureKeyword(connection, kw, req.user?.userId);
        const keywordId = kwRes && kwRes.keywordId ? kwRes.keywordId : null;
        if (!keywordId) {
          skippedKeywords.push(kw);
          continue;
        }

        await connection.query(
          'INSERT IGNORE INTO AnswersKeywords (QuestionsAnswersID, KeywordID) VALUES (?, ?)',
          [qaId, keywordId]
        );
      }
    }

    await connection.commit();

    // 🆕 Clean up orphaned keywords after update
    const cleanupResult = await cleanupUnusedKeywords(connection);

    // Clear stopwords cache when keywords have changed
    clearStopwordsCache();

    // Notify WebSocket clients
    if (req.app.locals.notifyQuestionsAnswersUpdate) {
      req.app.locals.notifyQuestionsAnswersUpdate({ action: 'update', id: qaId });
    }

    // Export latest CSV in background
    exportLatestCSV(pool, req.user?.officerId || req.user?.userId).catch(() => {});

    // Build response message
    let message = 'แก้ไขคำถาม-คำตอบสำเร็จ';
    if (skippedKeywords.length > 0) {
      message += ` (ข้ามคำสำคัญ: ${skippedKeywords.join(', ')})`;
    }
    if (cleanupResult.deletedCount > 0) {
      message += ` (ลบคำสำคัญที่ไม่ใช้ ${cleanupResult.deletedCount} คำ)`;
    }

    res.status(200).json({
      success: true,
      message: message,
      data: { id: qaId, cleanedupKeywords: cleanupResult.deletedCount },
      skippedKeywords: skippedKeywords.length > 0 ? skippedKeywords : undefined
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Update QA error:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * GET /questionsanswers/delete-preview/:id
 * ดูข้อมูลที่จะถูกลบก่อนยืนยัน
 */
router.get('/delete-preview/:id', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const qaId = parseInt(req.params.id);
  if (!qaId || isNaN(qaId)) {
    return res.status(400).json({ success: false, message: 'Invalid QA ID' });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // Get QA info
    const [[qa]] = await connection.query(
      'SELECT QuestionsAnswersID, QuestionTitle FROM QuestionsAnswers WHERE QuestionsAnswersID = ?',
      [qaId]
    );

    if (!qa) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำถาม-คำตอบ' });
    }

    // Count related keywords
    const [[keywordsCount]] = await connection.query(
      'SELECT COUNT(*) as count FROM AnswersKeywords WHERE QuestionsAnswersID = ?',
      [qaId]
    );

    // Count related chat logs
    const [[chatLogsCount]] = await connection.query(
      'SELECT COUNT(*) as count FROM ChatLogHasAnswers WHERE QuestionsAnswersID = ?',
      [qaId]
    );

    // Count related feedbacks
    const [[feedbacksCount]] = await connection.query(
      `SELECT COUNT(*) as count FROM Feedbacks WHERE ChatLogID IN (
        SELECT ChatLogID FROM ChatLogHasAnswers WHERE QuestionsAnswersID = ?
      )`,
      [qaId]
    );

    res.json({
      success: true,
      data: {
        id: qa.QuestionsAnswersID,
        title: qa.QuestionTitle,
        relatedData: {
          keywords: keywordsCount.count,
          chatLogs: chatLogsCount.count,
          feedbacks: feedbacksCount.count
        }
      }
    });

  } catch (err) {
    console.error('Delete preview error:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * DELETE /questionsanswers/delete/:id
 * ลบคำถาม-คำตอบ
 */
router.delete('/delete/:id', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const qaId = parseInt(req.params.id);

  if (!qaId || isNaN(qaId)) {
    return res.status(400).json({ success: false, message: 'Invalid QA ID' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1. Remove feedbacks that reference chat logs for this QA (foreign key constraint)
    await connection.query(
      `DELETE FROM Feedbacks WHERE ChatLogID IN (
        SELECT ChatLogID FROM ChatLogHasAnswers WHERE QuestionsAnswersID = ?
      )`,
      [qaId]
    );

    // 2. Remove chat log references (foreign key constraint)
    await connection.query(
      'DELETE FROM ChatLogHasAnswers WHERE QuestionsAnswersID = ?',
      [qaId]
    );

    // 3. Remove keywords links
    await connection.query(
      'DELETE FROM AnswersKeywords WHERE QuestionsAnswersID = ?',
      [qaId]
    );

    // 4. Delete the QA record
    const [result] = await connection.query(
      'DELETE FROM QuestionsAnswers WHERE QuestionsAnswersID = ?',
      [qaId]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'ไม่พบคำถาม-คำตอบที่ต้องการลบ' });
    }

    // 🆕 Clean up orphaned keywords
    const cleanupResult = await cleanupUnusedKeywords(connection);

    await connection.commit();

    // Clear stopwords cache when keywords have changed
    clearStopwordsCache();

    // Notify WebSocket clients
    if (req.app.locals.notifyQuestionsAnswersUpdate) {
      req.app.locals.notifyQuestionsAnswersUpdate({ action: 'delete', id: qaId });
    }

    // Export latest CSV in background
    exportLatestCSV(pool, req.user?.officerId || req.user?.userId).catch(() => {});

    res.status(200).json({
      success: true,
      message: `ลบคำถาม-คำตอบสำเร็จ${cleanupResult.deletedCount > 0 ? ` (ลบคำสำคัญที่ไม่ใช้ ${cleanupResult.deletedCount} คำ)` : ''}`,
      data: { id: qaId, cleanedupKeywords: cleanupResult.deletedCount }
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Delete QA error:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * GET /questionsanswers/single/:id
 * ดึงข้อมูลคำถาม-คำตอบเดี่ยว
 */
router.get('/single/:id', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const qaId = parseInt(req.params.id);

  if (!qaId || isNaN(qaId)) {
    return res.status(400).json({ success: false, message: 'Invalid QA ID' });
  }

  try {
    // Get QA
    const [qa] = await pool.query(
      `SELECT qa.*, c.CategoriesName 
       FROM QuestionsAnswers qa 
       LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
       WHERE qa.QuestionsAnswersID = ?`,
      [qaId]
    );

    if (qa.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบคำถาม-คำตอบ' });
    }

    // Get keywords
    const [keywords] = await pool.query(
      `SELECT k.KeywordID, k.KeywordText 
       FROM AnswersKeywords ak 
       JOIN Keywords k ON ak.KeywordID = k.KeywordID 
       WHERE ak.QuestionsAnswersID = ?`,
      [qaId]
    );

    res.status(200).json({
      success: true,
      data: {
        ...qa[0],
        keywords: keywords
      }
    });

  } catch (err) {
    console.error('Get single QA error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /questionsanswers/categories
 * ดึงรายการหมวดหมู่ของหน่วยงานตัวเอง (ตาม OrgID)
 */
router.get('/categories', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  try {
    const userId = req.user?.userId;
    const userRole = req.user?.role;
    
    let userOrgID = null;
    
    // Check if user is Admin/Super Admin or Officer
    if (userRole === 'Admin' || userRole === 'Super Admin') {
      // Admin - get OrgID via Officers table where AdminUserID matches
      const [adminOfficers] = await pool.query(
        'SELECT DISTINCT OrgID FROM Officers WHERE AdminUserID = ? LIMIT 1',
        [userId]
      );
      if (adminOfficers && adminOfficers.length > 0) {
        userOrgID = adminOfficers[0].OrgID;
      }
    } else {
      // Officer - get OrgID directly from Officers table
      const [userInfo] = await pool.query(
        'SELECT OrgID FROM Officers WHERE OfficerID = ? LIMIT 1',
        [userId]
      );
      if (userInfo && userInfo.length > 0) {
        userOrgID = userInfo[0].OrgID;
      }
    }
    
    // If no OrgID found, return all categories (fallback for Super Admin)
    if (userOrgID === null) {
      const [allCategories] = await pool.query(
        'SELECT CategoriesID, CategoriesName FROM Categories ORDER BY CategoriesID'
      );
      return res.status(200).json({
        success: true,
        categories: allCategories,
        data: allCategories
      });
    }
    
    // Return categories that belong to officers in the same organization (OrgID)
    // Include main categories (ParentCategoriesID IS NULL) if they have sub-categories owned by this org
    const [categories] = await pool.query(
      `SELECT DISTINCT c.CategoriesID, c.CategoriesName
       FROM Categories c
       LEFT JOIN Officers o ON c.OfficerID = o.OfficerID
       WHERE o.OrgID = ?
       
       UNION
       
       SELECT DISTINCT parent.CategoriesID, parent.CategoriesName
       FROM Categories parent
       WHERE parent.ParentCategoriesID IS NULL
       AND EXISTS (
         SELECT 1 FROM Categories sub
         LEFT JOIN Officers o2 ON sub.OfficerID = o2.OfficerID
         WHERE sub.ParentCategoriesID = parent.CategoriesID
         AND o2.OrgID = ?
       )
       
       ORDER BY CategoriesID`,
      [userOrgID, userOrgID]
    );

    res.status(200).json({
      success: true,
      categories,
      data: categories
    });

  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /questionsanswers/preview-upload
 * Preview ว่าถ้า upload CSV นี้จะมี QA ไหนถูกลบบ้าง
 * Body: { qaIds: [1, 2, 3] } - รายการ QuestionsAnswersID ที่อยู่ใน CSV
 */
router.post('/preview-upload', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const uploaderId = req.user?.userId;
  if (!uploaderId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { qaIds } = req.body;
  const csvQaIds = new Set((qaIds || []).map(id => String(id)));

  try {
    // Get existing QAs for this officer
    const [existingRows] = await pool.query(
      'SELECT QuestionsAnswersID, QuestionTitle FROM QuestionsAnswers WHERE OfficerID = ?',
      [uploaderId]
    );

    // Find QAs that will be deleted (exist in DB but not in CSV)
    const toDelete = existingRows.filter(row => !csvQaIds.has(String(row.QuestionsAnswersID)));

    // Find QAs that will be updated (exist in both DB and CSV)
    const toUpdate = existingRows.filter(row => csvQaIds.has(String(row.QuestionsAnswersID)));

    // Find new QAs (in CSV but not in DB) - these are IDs that don't exist yet
    const existingIds = new Set(existingRows.map(r => String(r.QuestionsAnswersID)));
    const toInsert = [...csvQaIds].filter(id => !existingIds.has(id) && id !== '');

    res.status(200).json({
      success: true,
      preview: {
        toDelete: toDelete.map(r => ({
          id: r.QuestionsAnswersID,
          title: r.QuestionTitle
        })),
        toUpdate: toUpdate.length,
        toInsert: toInsert.length,
        totalInCSV: csvQaIds.size,
        totalExisting: existingRows.length
      }
    });

  } catch (err) {
    console.error('Preview upload error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /questionsanswers/cleanup-keywords
 * ทำความสะอาด keywords ที่ไม่ใช้งาน (orphaned keywords)
 * Optional: สำหรับการบำรุงรักษาระบบ
 */
router.post('/cleanup-keywords', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const cleanupResult = await cleanupUnusedKeywords(connection);

    await connection.commit();

    // Clear stopwords cache when keywords deleted
    clearStopwordsCache();

    res.status(200).json({
      success: true,
      message: `ทำความสะอาดเสร็จ - ลบคำสำคัญที่ไม่ใช้ ${cleanupResult.deletedCount} คำ`,
      data: {
        deletedCount: cleanupResult.deletedCount,
        deletedKeywords: cleanupResult.deletedKeywords
      }
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Cleanup keywords error:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * GET /questionsanswers/template
 * ดาวน์โหลดไฟล์ template CSV สำหรับอัพโหลดคำถาม-คำตอบ
 */
router.get('/template', (req, res) => {
  const fs = require('fs');
  const path = require('path');

  try {
    // Template header: no CategoriesName column (frontend will use CategoriesID only)
    const headers = 'QuestionTitle,ReviewDate,Keywords,CategoriesID,QuestionText';
    
    // Create template directory if it doesn't exist
    const templateDir = path.join(__dirname, '..', 'files', 'managequestionsanswers', 'templates');
    if (!fs.existsSync(templateDir)) {
      fs.mkdirSync(templateDir, { recursive: true });
    }

    // Create template file
    const templatePath = path.join(templateDir, 'questionsanswers_template.csv');
    fs.writeFileSync(templatePath, headers, 'utf8');

    // Send file as download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="questionsanswers_template.csv"');
    res.status(200).send(headers);
  } catch (err) {
    console.error('Template generation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /questionsanswers
 * ดึงรายการคำถาม-คำตอบของเจ้าหน้าที่ที่ล็อกอิน
 */
router.get('/questionsanswers', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }
  try {
    const officerId = req.user?.userId;
    const userRole = req.user?.role;
    
    // Allow admins to see all questions, officers only see their own
    const isAdmin = userRole === 'Super Admin' || userRole === 'Admin';
    const targetOfficerId = isAdmin ? null : officerId;
    
    let query, params;
    if (isAdmin) {
      // Admin sees all questions
      query = `SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.ReviewDate, qa.QuestionText, qa.OfficerID,
          c.CategoriesName AS CategoriesID
       FROM QuestionsAnswers qa
       LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
       ORDER BY qa.QuestionsAnswersID DESC`;
      params = [];
    } else {
      // Officer sees only their questions
      query = `SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.ReviewDate, qa.QuestionText, qa.OfficerID,
          c.CategoriesName AS CategoriesID
       FROM QuestionsAnswers qa
       LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
       WHERE qa.OfficerID = ?
       ORDER BY qa.QuestionsAnswersID DESC`;
      params = [targetOfficerId];
    }
    
    const [rows] = await pool.query(query, params);
    
    // Get keywords and feedback counts for each question
    const questionsWithKeywords = await Promise.all(
      rows.map(async (question) => {
        try {
          const [keywords] = await pool.query(
            `SELECT k.KeywordID, k.KeywordText 
             FROM Keywords k
             INNER JOIN AnswersKeywords ak ON k.KeywordID = ak.KeywordID
             WHERE ak.QuestionsAnswersID = ?`,
            [question.QuestionsAnswersID]
          );
          
          // Get like/unlike counts for this question
          const [feedbackCounts] = await pool.query(
            `SELECT 
                SUM(CASE WHEN f.FeedbackValue = 1 THEN 1 ELSE 0 END) as likeCount,
                SUM(CASE WHEN f.FeedbackValue = 0 AND f.HandledAt IS NULL THEN 1 ELSE 0 END) as unlikeCount
             FROM Feedbacks f
             INNER JOIN ChatLogHasAnswers c ON f.ChatLogID = c.ChatLogID
             WHERE c.QuestionsAnswersID = ?`,
            [question.QuestionsAnswersID]
          );
          
          const likeCount = feedbackCounts[0]?.likeCount || 0;
          const unlikeCount = feedbackCounts[0]?.unlikeCount || 0;
          
          return {
            ...question,
            keywords: keywords || [],
            likeCount: likeCount,
            unlikeCount: unlikeCount
          };
        } catch (keywordError) {
          console.error('Error fetching keywords/feedback for question', question.QuestionsAnswersID, ':', keywordError.message);
          // Return question without keywords if there's an error
          return {
            ...question,
            keywords: [],
            likeCount: 0,
            unlikeCount: 0
          };
        }
      })
    );
    
    res.status(200).json({ success: true, data: questionsWithKeywords });
  } catch (err) {
    console.error('Get questionsanswers error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /questionsanswers/popular
 * ดึงคำถามยอดนิยม (เรียงตามจำนวน like มากที่สุด)
 */
router.get('/popular', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  try {
    const limit = parseInt(req.query.limit) || 10;
    
    // Query questions with most likes
    const [rows] = await pool.query(`
      SELECT 
        q.QuestionsID,
        q.QuestionTitle,
        COUNT(f.FeedbackID) as likeCount
      FROM QuestionsAnswers q
      LEFT JOIN ChatLogs cl ON cl.QuestionID = q.QuestionsID
      LEFT JOIN Feedbacks f ON f.ChatLogID = cl.ChatLogID AND f.FeedbackValue = 1
      GROUP BY q.QuestionsID, q.QuestionTitle
      HAVING likeCount > 0
      ORDER BY likeCount DESC
      LIMIT ?
    `, [limit]);
    
    res.status(200).json({ 
      success: true, 
      data: rows.map(r => ({
        id: r.QuestionsID,
        title: r.QuestionTitle,
        likeCount: r.likeCount
      }))
    });
  } catch (err) {
    console.error('Get popular questions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
