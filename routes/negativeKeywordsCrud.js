/**
 * Negative Keywords CRUD API
 * จัดการคำปฏิเสธ (ไม่, ยกเว้น, อย่า, ห้าม ฯลฯ)
 * ใช้สำหรับดักจับคำปฏิเสธก่อนหน้า Keyword เพื่อเปลี่ยนคะแนน
 */

const express = require('express');
const { clearNegativeKeywordsCache } = require('../services/negativeKeywords/loadNegativeKeywords');
const manageNegativeService = require('../services/managenegativekeywords');

module.exports = function(pool) {
  const router = express.Router();

  /**
   * GET /negativekeywords
   * ดึงรายการคำปฏิเสธทั้งหมด (พร้อม pagination และ search)
   */
  router.get('/', async (req, res) => {
    try {
      const { search = '', page = 1, limit = 50, active } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      let whereClause = '1=1';
      const params = [];

      if (search) {
        whereClause += ' AND (Word LIKE ? OR Description LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }

      if (active !== undefined) {
        whereClause += ' AND IsActive = ?';
        params.push(parseInt(active));
      }

      // Get total count
      const [countResult] = await pool.query(
        `SELECT COUNT(*) as total FROM NegativeKeywords WHERE ${whereClause}`,
        params
      );

      // Get data with pagination
      const [rows] = await pool.query(
        `SELECT * FROM NegativeKeywords 
         WHERE ${whereClause}
         ORDER BY Word ASC
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), offset]
      );

      // Get stats
      const [stats] = await pool.query(`
        SELECT 
          COUNT(*) as total,
          SUM(IsActive = 1) as active,
          SUM(WeightModifier = -1.0) as negativeModifier,
          SUM(WeightModifier = 0.0) as zeroModifier
        FROM NegativeKeywords
      `);

      res.json({
        ok: true,
        data: rows,
        pagination: {
          total: countResult[0].total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(countResult[0].total / parseInt(limit))
        },
        stats: stats[0]
      });
    } catch (error) {
      console.error('Get negative keywords error:', error);
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  /**
   * GET /negativekeywords/all
   * ดึงคำปฏิเสธที่ active ทั้งหมด (สำหรับใช้ใน scoring logic)
   */
  router.get('/all', async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT Word, WeightModifier FROM NegativeKeywords WHERE IsActive = 1`
      );

      // Return as a Map-like object for fast lookup
      const negativeMap = {};
      rows.forEach(row => {
        negativeMap[row.Word] = row.WeightModifier;
      });

      res.json({
        ok: true,
        data: rows,
        map: negativeMap
      });
    } catch (error) {
      console.error('Get all negative keywords error:', error);
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  /**
   * POST /negativekeywords
   * เพิ่มคำปฏิเสธใหม่
   */
  router.post('/', async (req, res) => {
    try {
      const { word, weightModifier = -1.0, description = '' } = req.body;

      if (!word || !word.trim()) {
        return res.status(400).json({ ok: false, message: 'กรุณาระบุคำปฏิเสธ' });
      }

      const trimmedWord = word.trim();

      // Check duplicate
      const [existing] = await pool.query(
        'SELECT NegativeKeywordID FROM NegativeKeywords WHERE Word = ?',
        [trimmedWord]
      );

      if (existing.length > 0) {
        return res.status(400).json({ ok: false, message: `คำว่า "${trimmedWord}" มีอยู่ในระบบแล้ว` });
      }

      // Insert
      const [result] = await pool.query(
        `INSERT INTO NegativeKeywords (Word, WeightModifier, Description) VALUES (?, ?, ?)`,
        [trimmedWord, parseFloat(weightModifier), description.trim()]
      );

      // Clear cache and reload from database
      await clearNegativeKeywordsCache(pool);

      res.json({
        ok: true,
        message: `เพิ่มคำปฏิเสธ "${trimmedWord}" สำเร็จ`,
        data: {
          id: result.insertId,
          word: trimmedWord,
          weightModifier: parseFloat(weightModifier),
          description: description.trim()
        }
      });
    } catch (error) {
      console.error('Create negative keyword error:', error);
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  /**
   * POST /negativekeywords/bulk
   * เพิ่มหลายคำพร้อมกัน (comma separated)
   */
  router.post('/bulk', async (req, res) => {
    try {
      const { words, weightModifier = -1.0 } = req.body;

      if (!words || !words.trim()) {
        return res.status(400).json({ ok: false, message: 'กรุณาระบุคำปฏิเสธ' });
      }

      const wordList = words.split(',').map(w => w.trim()).filter(w => w.length > 0);
      
      if (wordList.length === 0) {
        return res.status(400).json({ ok: false, message: 'ไม่พบคำที่จะเพิ่ม' });
      }

      let added = 0, skipped = 0;
      const skippedWords = [];

      for (const word of wordList) {
        try {
          await pool.query(
            `INSERT INTO NegativeKeywords (Word, WeightModifier) VALUES (?, ?)`,
            [word, parseFloat(weightModifier)]
          );
          added++;
        } catch (e) {
          if (e.code === 'ER_DUP_ENTRY') {
            skipped++;
            skippedWords.push(word);
          } else {
            throw e;
          }
        }
      }

      res.json({
        ok: true,
        message: `เพิ่มสำเร็จ ${added} คำ${skipped > 0 ? `, ข้าม ${skipped} คำ (ซ้ำ)` : ''}`,
        data: { added, skipped, skippedWords }
      });
      
      // Clear cache and reload from database
      if (added > 0) {
        await clearNegativeKeywordsCache(pool);
      }
    } catch (error) {
      console.error('Bulk create negative keywords error:', error);
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  /**
   * PUT /negativekeywords/:id
   * แก้ไขคำปฏิเสธ
   */
  router.put('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { word, weightModifier, description, isActive } = req.body;

      // Check exists
      const [existing] = await pool.query(
        'SELECT * FROM NegativeKeywords WHERE NegativeKeywordID = ?',
        [id]
      );

      if (existing.length === 0) {
        return res.status(404).json({ ok: false, message: 'ไม่พบคำปฏิเสธที่ต้องการแก้ไข' });
      }

      // Check duplicate if word changed
      if (word && word.trim() !== existing[0].Word) {
        const [dup] = await pool.query(
          'SELECT NegativeKeywordID FROM NegativeKeywords WHERE Word = ? AND NegativeKeywordID != ?',
          [word.trim(), id]
        );
        if (dup.length > 0) {
          return res.status(400).json({ ok: false, message: `คำว่า "${word.trim()}" มีอยู่ในระบบแล้ว` });
        }
      }

      // Build update query
      const updates = [];
      const params = [];

      if (word !== undefined) {
        updates.push('Word = ?');
        params.push(word.trim());
      }
      if (weightModifier !== undefined) {
        updates.push('WeightModifier = ?');
        params.push(parseFloat(weightModifier));
      }
      if (description !== undefined) {
        updates.push('Description = ?');
        params.push(description.trim());
      }
      if (isActive !== undefined) {
        updates.push('IsActive = ?');
        params.push(isActive ? 1 : 0);
      }

      if (updates.length === 0) {
        return res.status(400).json({ ok: false, message: 'ไม่มีข้อมูลที่จะแก้ไข' });
      }

      params.push(id);
      await pool.query(
        `UPDATE NegativeKeywords SET ${updates.join(', ')} WHERE NegativeKeywordID = ?`,
        params
      );

      // Clear cache and reload from database
      await clearNegativeKeywordsCache(pool);

      res.json({
        ok: true,
        message: 'แก้ไขคำปฏิเสธสำเร็จ'
      });
    } catch (error) {
      console.error('Update negative keyword error:', error);
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  /**
   * DELETE /negativekeywords/:id
   * ลบคำปฏิเสธ (ปลอดภัย): ย้ายคำไปยัง Ignored/Blacklist เพื่อป้องกัน Auto-add คืน
   */
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      console.log('🗑️ DELETE request for ID:', id);

      // Use manageNegativeService to perform a safe deletion + mark ignored
      const result = await manageNegativeService.deleteNegativeKeywordSafe(pool, id);

      if (!result || !result.ok) {
        console.log('❌ Delete failed or not found:', id, result && result.message);
        return res.status(404).json({ ok: false, message: result && result.message ? result.message : 'ไม่พบคำปฏิเสธที่ต้องการลบ' });
      }

      console.log('🗑️ Safely deleted and ignored:', result.word);

      res.json({
        ok: true,
        message: `ลบคำปฏิเสธ "${result.word}" สำเร็จ`,
        data: result
      });
    } catch (error) {
      console.error('❌ Delete negative keyword error:', error);
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  /**
   * POST /negativekeywords/delete
   * Safe delete by word: removes from active and marks as ignored (prevents auto-populate)
   */
  router.post('/delete', async (req, res) => {
    try {
      const { word } = req.body;

      if (!word || !String(word).trim()) {
        return res.status(400).json({ ok: false, message: 'กรุณาระบุคำที่จะลบ' });
      }

      const result = await manageNegativeService.deleteNegativeKeywordSafe(pool, word);
      if (!result || !result.ok) {
        return res.status(404).json({ ok: false, message: result && result.message ? result.message : 'ไม่พบคำปฏิเสธที่ต้องการลบ' });
      }

      res.json({ ok: true, message: `ลบคำปฏิเสธ "${result.word}" สำเร็จ`, data: result });
    } catch (error) {
      console.error('❌ Safe delete by word failed:', error && error.message);
      res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาดในการลบคำ' });
    }
  });

  /**
   * POST /negativekeywords/toggle/:id
   * Toggle active/inactive
   */
  router.post('/toggle/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const [existing] = await pool.query(
        'SELECT Word, IsActive FROM NegativeKeywords WHERE NegativeKeywordID = ?',
        [id]
      );

      if (existing.length === 0) {
        return res.status(404).json({ ok: false, message: 'ไม่พบคำปฏิเสธ' });
      }

      const newStatus = existing[0].IsActive ? 0 : 1;
      await pool.query(
        'UPDATE NegativeKeywords SET IsActive = ? WHERE NegativeKeywordID = ?',
        [newStatus, id]
      );

      // Clear cache and reload from database
      await clearNegativeKeywordsCache(pool);

      res.json({
        ok: true,
        message: `${newStatus ? 'เปิด' : 'ปิด'}ใช้งานคำว่า "${existing[0].Word}" แล้ว`,
        data: { isActive: newStatus === 1 }
      });
    } catch (error) {
      console.error('Toggle negative keyword error:', error);
      res.status(500).json({ ok: false, message: error.message });
    }
  });

  return router;
};
