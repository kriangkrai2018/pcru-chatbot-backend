/**
 * Officers CRUD API
 * เพิ่ม, แก้ไข, ลบ เจ้าหน้าที่
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const writeOfficersCSV = require('../services/Officers/writeOfficersCSV');

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
 * GET /officers/crud/list
 * ดึงรายการเจ้าหน้าที่ทั้งหมด
 */
router.get('/list', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  try {
    const adminId = req.user?.userId;
    let officersQuery, params;
    if (adminId) {
      officersQuery = `SELECT o.OfficerID, o.OfficerName, o.OfficerPhone, o.Email AS OfficerEmail, 1 AS OfficerStatus, o.OrgID, org.OrgName
                       FROM Officers o
                       LEFT JOIN Organizations org ON o.OrgID = org.OrgID
                       WHERE o.AdminUserID = ? OR o.AdminUserID IN (SELECT AdminUserID FROM AdminUsers WHERE ParentAdminID = ?)
                       ORDER BY o.OfficerID DESC`;
      params = [adminId, adminId];
    } else {
      officersQuery = `SELECT o.OfficerID, o.OfficerName, o.OfficerPhone, o.Email AS OfficerEmail, 1 AS OfficerStatus, o.OrgID, org.OrgName
                       FROM Officers o
                       LEFT JOIN Organizations org ON o.OrgID = org.OrgID
                       ORDER BY o.OfficerID DESC`;
      params = [];
    }

    const [officers] = await pool.query(officersQuery, params);

    res.status(200).json({
      success: true,
      data: officers
    });

  } catch (err) {
    console.error('Get officers list error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Generate random password (8 characters)
 */
function generateRandomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * POST /officers/crud/create
 * เพิ่มเจ้าหน้าที่ใหม่
 */
router.post('/create', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const { officerName, officerPhone, officerEmail, orgID } = req.body;

  if (!officerName || !officerName.trim()) {
    return res.status(400).json({ success: false, message: 'ชื่อเจ้าหน้าที่จำเป็นต้องระบุ' });
  }

  if (!officerEmail || !officerEmail.trim()) {
    return res.status(400).json({ success: false, message: 'อีเมลจำเป็นต้องระบุ' });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // Check if email already exists
    const [existing] = await connection.query(
      'SELECT OfficerID FROM Officers WHERE Email = ?',
      [officerEmail.trim()]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: 'อีเมลนี้มีอยู่ในระบบแล้ว' });
    }

    // Generate random password
    const plainPassword = generateRandomPassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // Get AdminUserID from request user (from JWT token) - default to 1 if not found
    const adminUserId = req.user?.userId || req.user?.AdminUserID || req.user?.id || 1;

    // Insert new officer with AdminUserID
    const [result] = await connection.query(
      `INSERT INTO Officers (OfficerName, OfficerPhone, Email, OfficerPassword, AdminUserID, OrgID) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        officerName.trim(),
        officerPhone?.trim() || null,
        officerEmail.trim(),
        hashedPassword,
        adminUserId,
        orgID || null
      ]
    );

    const newOfficerId = result.insertId;

    try {
      const targetId = Number(req.user?.userId) === 1001 ? 1001 : req.user?.userId;
      console.log('Invoking writeOfficersCSV for create, poolPresent=', !!req.pool, 'targetId=', targetId);
      const { latestPath } = await writeOfficersCSV(req.pool, targetId)();
      console.log(`✅ writeOfficersCSV after create: wrote latestPath=${latestPath}`);
      res.status(201).json({
        success: true,
        message: 'เพิ่มเจ้าหน้าที่สำเร็จ',
        data: { id: newOfficerId, name: officerName.trim(), generatedPassword: plainPassword },
        latestPath
      });

      // Fire-and-forget background attempt to ensure CSV update even if immediate writer failed later
      setImmediate(() => {
        (async () => {
          try {
            const mysql = require('mysql2/promise');
            const tmpPool = await mysql.createPool({ host: process.env.DB_HOST || 'project.3bbddns.com', user: process.env.DB_USER || 'root', database: process.env.DB_NAME || 'pcru_auto_response', waitForConnections: true, connectionLimit: 2 });
            await writeOfficersCSV(tmpPool, targetId)();
            await tmpPool.end();
            console.log('✅ background writeOfficersCSV after create succeeded');
          } catch (bgErr) {
            console.error('❌ background writeOfficersCSV after create failed:', bgErr && (bgErr.stack || bgErr.message || bgErr));
          }
        })();
      });
    } catch (err) {
      console.error('writeOfficersCSV after create failed:', err && (err.stack || err.message || err));
      // Attempt a retry with a fresh pool in case the app pool was temporarily unavailable
      try {
        const mysql = require('mysql2/promise');
        const tmpPool = await mysql.createPool({ host: process.env.DB_HOST || 'project.3bbddns.com', user: process.env.DB_USER || 'root', database: process.env.DB_NAME || 'pcru_auto_response', waitForConnections: true, connectionLimit: 2 });
        const { latestPath: retryPath } = await writeOfficersCSV(tmpPool, targetId)();
        console.log(`✅ writeOfficersCSV retry after create succeeded: ${retryPath}`);
        await tmpPool.end();
        // also start background writer to be safe
        setImmediate(() => {
          (async () => {
            try {
              const mysql = require('mysql2/promise');
              const tmpPool2 = await mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER || 'root', database: process.env.DB_NAME || 'pcru_auto_response', waitForConnections: true, connectionLimit: 2 });
              await writeOfficersCSV(tmpPool2, targetId)();
              await tmpPool2.end();
              console.log('✅ background writeOfficersCSV retry after create succeeded');
            } catch (bgErr) {
              console.error('❌ background writeOfficersCSV retry after create failed:', bgErr && (bgErr.stack || bgErr.message || bgErr));
            }
          })();
        });
        return res.status(201).json({ success: true, message: 'เพิ่มเจ้าหน้าที่สำเร็จ', data: { id: newOfficerId, name: officerName.trim(), generatedPassword: plainPassword }, latestPath: retryPath });
      } catch (retryErr) {
        console.error('writeOfficersCSV retry failed:', retryErr && (retryErr.stack || retryErr.message || retryErr));
        // Start background writer attempt to not block request
        setImmediate(() => {
          (async () => {
            try {
              const mysql = require('mysql2/promise');
              const tmpPool3 = await mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER || 'root', database: process.env.DB_NAME || 'pcru_auto_response', waitForConnections: true, connectionLimit: 2 });
              await writeOfficersCSV(tmpPool3, targetId)();
              await tmpPool3.end();
              console.log('✅ background writeOfficersCSV final attempt after create succeeded');
            } catch (bgErr) {
              console.error('❌ background writeOfficersCSV final attempt after create failed:', bgErr && (bgErr.stack || bgErr.message || bgErr));
            }
          })();
        });
        return res.status(201).json({ success: true, message: 'เพิ่มเจ้าหน้าที่สำเร็จ', data: { id: newOfficerId, name: officerName.trim(), generatedPassword: plainPassword }, latestPath: null, writerError: (retryErr && (retryErr.stack || retryErr.message || String(retryErr))) });
      }
    }

  } catch (err) {
    console.error('Create officer error:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

// GET /officers/template - download CSV template (headers only)
router.get('/template', async (req, res) => {
  try {
    // Store templates separately from user uploads
    const baseDir = path.join(__dirname, '..', 'files', 'manageofficers', 'templates');
    fs.mkdirSync(baseDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `officers_template_${timestamp}.csv`;
    const filePath = path.join(baseDir, filename);

    const headers = 'OfficerName,OfficerPhone,Email,OfficerStatus,OrgID\n';
    fs.writeFileSync(filePath, headers, 'utf8');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Download template error:', err);
    res.status(500).json({ success: false, message: 'ไม่สามารถสร้างไฟล์ตัวอย่างได้' });
  }
});

/**
 * PUT /officers/crud/update/:id
 * แก้ไขเจ้าหน้าที่
 */
router.put('/update/:id', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const officerId = req.params.id;
  const { officerName, officerPhone, officerEmail, officerPassword, officerStatus, orgID } = req.body;

  if (!officerId) {
    return res.status(400).json({ success: false, message: 'Invalid Officer ID' });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // Check if officer exists
    const [existingOfficer] = await connection.query(
      'SELECT OfficerID FROM Officers WHERE OfficerID = ?',
      [officerId]
    );

    if (existingOfficer.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบเจ้าหน้าที่ที่ต้องการแก้ไข' });
    }

    // Check if new email conflicts with another officer
    if (officerEmail) {
      const [emailConflict] = await connection.query(
        'SELECT OfficerID FROM Officers WHERE Email = ? AND OfficerID != ?',
        [officerEmail.trim(), officerId]
      );

      if (emailConflict.length > 0) {
        return res.status(400).json({ success: false, message: 'อีเมลนี้มีอยู่ในระบบแล้ว' });
      }
    }

    // Build update query
    const updateFields = [];
    const updateValues = [];

    if (officerName !== undefined) {
      updateFields.push('OfficerName = ?');
      updateValues.push(officerName.trim());
    }
    if (officerPhone !== undefined) {
      updateFields.push('OfficerPhone = ?');
      updateValues.push(officerPhone?.trim() || null);
    }
    if (officerEmail !== undefined) {
      updateFields.push('Email = ?');
      updateValues.push(officerEmail.trim());
    }
    if (officerPassword !== undefined && officerPassword.trim()) {
      const hashedPassword = await bcrypt.hash(officerPassword.trim(), 10);
      updateFields.push('OfficerPassword = ?');
      updateValues.push(hashedPassword);
    }

    if (orgID !== undefined) {
      updateFields.push('OrgID = ?');
      updateValues.push(orgID || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่มีข้อมูลที่ต้องการแก้ไข' });
    }

    updateValues.push(officerId);

    await connection.query(
      `UPDATE Officers SET ${updateFields.join(', ')} WHERE OfficerID = ?`,
      updateValues
    );

    try {
      const targetId = Number(req.user?.userId) === 1001 ? 1001 : req.user?.userId;
      const { latestPath } = await writeOfficersCSV(req.pool, targetId)();
      console.log(`✅ writeOfficersCSV after update: wrote latestPath=${latestPath}`);
      res.status(200).json({ success: true, message: 'แก้ไขเจ้าหน้าที่สำเร็จ', data: { id: officerId }, latestPath });
    } catch (err) {
      console.error('writeOfficersCSV after update failed:', err && (err.message || err));
      res.status(200).json({ success: true, message: 'แก้ไขเจ้าหน้าที่สำเร็จ', data: { id: officerId }, latestPath: null });
    }

  } catch (err) {
    console.error('Update officer error:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * DELETE /officers/crud/delete/:id
 * ลบเจ้าหน้าที่
 */
router.delete('/delete/:id', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  const officerId = req.params.id;

  if (!officerId) {
    return res.status(400).json({ success: false, message: 'Invalid Officer ID' });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // Check if officer has associated Categories
    const [catCount] = await connection.query(
      'SELECT COUNT(*) AS count FROM Categories WHERE OfficerID = ?',
      [officerId]
    );

    if (catCount[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: `ไม่สามารถลบเจ้าหน้าที่นี้ได้ เนื่องจากมีหมวดหมู่ ${catCount[0].count} รายการที่เชื่อมโยงอยู่`,
        catCount: catCount[0].count
      });
    }

    // Delete the officer
    const [result] = await connection.query(
      'DELETE FROM Officers WHERE OfficerID = ?',
      [officerId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบเจ้าหน้าที่ที่ต้องการลบ' });
    }

    try {
      const targetId = Number(req.user?.userId) === 1001 ? 1001 : req.user?.userId;
      const { latestPath } = await writeOfficersCSV(req.pool, targetId)();
      console.log(`✅ writeOfficersCSV after delete: wrote latestPath=${latestPath}`);
      res.status(200).json({ success: true, message: 'ลบเจ้าหน้าที่สำเร็จ', latestPath });
    } catch (err) {
      console.error('writeOfficersCSV after delete failed:', err && (err.message || err));
      res.status(200).json({ success: true, message: 'ลบเจ้าหน้าที่สำเร็จ', latestPath: null });
    }

  } catch (err) {
    console.error('Delete officer error:', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    if (connection) connection.release();
  }
});

/**
 * GET /officers/crud/organizations
 * ดึงรายการ Organizations สำหรับ dropdown
 */
router.get('/organizations', async (req, res) => {
  const pool = req.pool;
  if (!pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }

  try {
    const [orgs] = await pool.query(
      'SELECT OrgID, OrgName FROM Organizations ORDER BY OrgName'
    );

    res.status(200).json({
      success: true,
      data: orgs
    });

  } catch (err) {
    console.error('Get organizations error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
