const express = require('express');
const router = express.Router();
// นำเข้า Service ที่เราเตรียมไว้ (path ให้ตรงกับโครงสร้างโฟลเดอร์)
const negativeService = require('../services/managenegativekeywords');
// Loader service (for reloading cache after seeding)
const negativeLoader = require('../services/negativeKeywords/loadNegativeKeywords');

// Middleware: ตรวจสอบ Database Pool
router.use((req, res, next) => {
  // Resolve pool from request, app.locals, or global
  const poolFromApp = req.app && req.app.locals && req.app.locals.pool;
  if (!req.pool && !poolFromApp && !global.__DB_POOL__ && !global.pool) {
    console.error('🔴 DB pool not found (req.pool, app.locals.pool, global.__DB_POOL__, global.pool)');
    return res.status(500).json({ ok: false, message: 'Database connection failed' });
  }
  req.pool = req.pool || poolFromApp || global.__DB_POOL__ || global.pool;
  next();
});

/**
 * GET /
 * ดึงข้อมูลพร้อม Pagination, Search, Filter และ Stats
 */
router.get('/', async (req, res) => {
  let conn;
  try {
    console.log('🔍 GET /negativekeywords called; auth=', !!req.user, 'pool=', !!req.pool);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search ? req.query.search.trim() : '';
    const activeFilter = req.query.active; // 1, 0, or undefined

    conn = await req.pool.getConnection();
    if (!conn) throw new Error('Failed to get DB connection in negativeKeywords route');

    // 1. สร้างเงื่อนไข WHERE
    let whereClauses = [];
    let params = [];

    if (search) {
      whereClauses.push('Word LIKE ?');
      params.push(`%${search}%`);
    }

    if (activeFilter !== undefined && activeFilter !== 'undefined') {
      whereClauses.push('IsActive = ?');
      params.push(parseInt(activeFilter));
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // 2. Query ข้อมูลหลัก
    const sql = `
      SELECT SQL_CALC_FOUND_ROWS * FROM NegativeKeywords 
      ${whereSql} 
      ORDER BY NegativeKeywordID DESC 
      LIMIT ? OFFSET ?
    `;
    
    const [rows] = await conn.query(sql, [...params, limit, offset]);

    // 3. หาจำนวนรายการทั้งหมด (สำหรับ Pagination) - more robust handling
    const [foundRows] = await conn.query('SELECT FOUND_ROWS() as total');
    const total = Array.isArray(foundRows) && foundRows.length > 0 ? (foundRows[0].total || 0) : 0;

    // 4. คำนวณ Stats (นับรวมทั้งหมด ไม่สนใจ Filter)
    const [statsRows] = await conn.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN WeightModifier = -1.0 THEN 1 ELSE 0 END) as negativeModifier,
        SUM(CASE WHEN WeightModifier = 0.0 THEN 1 ELSE 0 END) as zeroModifier
      FROM NegativeKeywords
    `);
    const stats = statsRows[0];

    res.json({
      ok: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      stats: {
        total: stats.total || 0,
        active: stats.active || 0,
        negativeModifier: stats.negativeModifier || 0,
        zeroModifier: stats.zeroModifier || 0
      }
    });

  } catch (error) {
    console.error('Error fetching keywords:', error && (error.stack || error));
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + (error && error.message ? error.message : String(error)) });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * POST /
 * เพิ่มคำปฏิเสธ (ทีละคำ)
 */
router.post('/', async (req, res) => {
  let conn;
  try {
    const { word, weightModifier, description } = req.body;
    
    if (!word) return res.status(400).json({ ok: false, message: 'กรุณาระบุคำปฏิเสธ' });

    conn = await req.pool.getConnection();
    
    const [result] = await conn.query(
      `INSERT INTO NegativeKeywords (Word, WeightModifier, Description, IsActive) 
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE IsActive = 1, WeightModifier = VALUES(WeightModifier), Description = VALUES(Description)`,
      [word.trim(), parseFloat(weightModifier) || -1.0, description || '']
    );

    res.json({ 
      ok: true, 
      message: `เพิ่มคำว่า "${word}" เรียบร้อยแล้ว`,
      id: result.insertId
    });

  } catch (error) {
    console.error('Error adding keyword:', error);
    res.status(500).json({ ok: false, message: 'บันทึกไม่สำเร็จ: ' + (error && error.message) });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * POST /bulk
 * เพิ่มคำปฏิเสธ (หลายคำคั่นด้วย comma)
 */
router.post('/bulk', async (req, res) => {
  let conn;
  try {
    const { words, weightModifier } = req.body;
    if (!words) return res.status(400).json({ ok: false, message: 'กรุณาระบุคำ' });

    const wordList = words.split(',').map(w => w.trim()).filter(w => w);
    if (wordList.length === 0) return res.status(400).json({ ok: false, message: 'ไม่พบคำที่ถูกต้อง' });

    conn = await req.pool.getConnection();
    
    let successCount = 0;
    for (const w of wordList) {
      await conn.query(
        `INSERT INTO NegativeKeywords (Word, WeightModifier, IsActive) 
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE IsActive = 1`,
        [w, parseFloat(weightModifier) || -1.0]
      );
      successCount++;
    }

    res.json({ ok: true, message: `เพิ่มสำเร็จ ${successCount} คำ` });

  } catch (error) {
    console.error('Error bulk adding:', error);
    res.status(500).json({ ok: false, message: error && error.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * PUT /:id
 * แก้ไขข้อมูล
 */
router.put('/:id', async (req, res) => {
  let conn;
  try {
    const id = req.params.id;
    const { word, weightModifier, description } = req.body;

    conn = await req.pool.getConnection();
    await conn.query(
      'UPDATE NegativeKeywords SET Word = ?, WeightModifier = ?, Description = ? WHERE NegativeKeywordID = ?',
      [word.trim(), weightModifier, description, id]
    );

    res.json({ ok: true, message: 'บันทึกการแก้ไขแล้ว' });

  } catch (error) {
    console.error('Error updating:', error);
    res.status(500).json({ ok: false, message: error && error.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * POST /toggle/:id
 * เปลี่ยนสถานะ Active/Inactive
 */
router.post('/toggle/:id', async (req, res) => {
  let conn;
  try {
    const id = req.params.id;
    conn = await req.pool.getConnection();
    
    const [rows] = await conn.query('SELECT IsActive FROM NegativeKeywords WHERE NegativeKeywordID = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ ok: false, message: 'ไม่พบข้อมูล' });

    const newStatus = rows[0].IsActive ? 0 : 1;
    await conn.query('UPDATE NegativeKeywords SET IsActive = ? WHERE NegativeKeywordID = ?', [newStatus, id]);

    res.json({ 
      ok: true, 
      message: newStatus ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว',
      data: { isActive: newStatus }
    });

  } catch (error) {
    console.error('Error toggling:', error);
    res.status(500).json({ ok: false, message: error && error.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * DELETE /:id
 * ลบคำปฏิเสธ (Safe Delete)
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    const result = await negativeService.deleteNegativeKeywordSafe(req.pool, id);

    if (result.ok) {
      res.json({ 
        ok: true, 
        message: `ลบคำว่า "${result.word || 'คำนี้'}" เรียบร้อยแล้ว (Added to ignore list)` 
      });
    } else {
      res.status(400).json({ ok: false, message: result.message || 'ไม่สามารถลบได้' });
    }

  } catch (error) {
    console.error('Error deleting:', error);
    res.status(500).json({ ok: false, message: 'เกิดข้อผิดพลาด: ' + (error && error.message) });
  }
});

/**
 * POST /seed
 * เติมคำมาตรฐานเข้า DB หากยังไม่มี และไม่อยู่ในตาราง Ignored
 */
router.post('/seed', async (req, res) => {
  let conn;
  try {
    conn = await req.pool.getConnection();

    const sql = `
      INSERT INTO NegativeKeywords (Word, WeightModifier, IsActive)
      SELECT * FROM (
        SELECT 'ไม่' AS Word, -1.0 AS WeightModifier, 1 AS IsActive
        UNION ALL SELECT 'ไม่ได้', -1.0, 1
        UNION ALL SELECT 'มิได้', -1.0, 1
        UNION ALL SELECT 'หาไม่', -1.0, 1
        UNION ALL SELECT 'หามิได้', -1.0, 1
        UNION ALL SELECT 'เปล่า', -1.0, 1
        UNION ALL SELECT 'อย่า', -1.0, 1
        UNION ALL SELECT 'ไม่ใช่', -1.0, 1
        UNION ALL SELECT 'มิใช่', -1.0, 1
        UNION ALL SELECT 'ไม่มี', -1.0, 1
        UNION ALL SELECT 'บ่', -1.0, 1
        UNION ALL SELECT 'ไม่เอา', -1.0, 1
        UNION ALL SELECT 'ไม่ต้อง', -1.0, 1
        UNION ALL SELECT 'ไม่อยาก', -1.0, 1
        UNION ALL SELECT 'ไม่ต้องการ', -1.0, 1
        UNION ALL SELECT 'ไม่สนใจ', -1.0, 1
        UNION ALL SELECT 'ไม่ชอบ', -1.0, 1
        UNION ALL SELECT 'ไม่รับ', -1.0, 1
        UNION ALL SELECT 'ยกเว้น', -1.0, 1
        UNION ALL SELECT 'ปราศจาก', -1.0, 1
        UNION ALL SELECT 'ไร้', -1.0, 1
      ) AS NewData
      WHERE 
        NOT EXISTS (SELECT 1 FROM NegativeKeywords WHERE Word = NewData.Word)
        AND NOT EXISTS (SELECT 1 FROM NegativeKeywords_Ignored WHERE Word = NewData.Word);
    `;

    const [result] = await conn.query(sql);

    // Reload in-memory cache
    try {
      await negativeLoader.loadNegativeKeywords(req.pool);
    } catch (e) {
      console.warn('⚠️ Reloading negative keywords cache after seed failed:', e && e.message);
    }

    res.json({ 
      ok: true, 
      message: `ตรวจสอบและเติมคำมาตรฐานสำเร็จ (เพิ่มใหม่ ${result.affectedRows} คำ)`,
      addedCount: result.affectedRows 
    });

  } catch (error) {
    console.error('Error seeding:', error && (error.stack || error));
    res.status(500).json({ ok: false, message: error && error.message ? error.message : String(error) });
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;

