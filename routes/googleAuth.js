/**
 * Google OAuth Routes
 * API สำหรับ Google OAuth Login และการจัดการบัญชี
 */

const express = require('express');
const router = express.Router();
const authenticateToken = require('../auth');
const googleOAuthService = require('../services/googleOAuth');

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
 * GET /auth/google
 * เริ่มต้นกระบวนการ Login ด้วย Google (Redirect ไปยัง Google)
 */
router.get('/google', (req, res) => {
  try {
    const url = googleOAuthService.getGoogleAuthUrl();
    res.redirect(url);
  } catch (error) {
    console.error('Error generating Google Auth URL:', error);
    res.status(500).json({ 
      success: false, 
      message: 'ไม่สามารถสร้าง URL สำหรับ Login ด้วย Google ได้' 
    });
  }
});

/**
 * GET /auth/google/url
 * ดึง URL สำหรับ Login ด้วย Google (สำหรับ Frontend ที่ต้องการเปิดเองใน Popup)
 * Query params: state (optional) - สำหรับผู้ใช้ที่ล็อกอินแล้วต้องการผูกบัญชี
 */
router.get('/google/url', (req, res) => {
  try {
    const { state } = req.query;
    const url = googleOAuthService.getGoogleAuthUrl(state || null);
    res.json({ success: true, url });
  } catch (error) {
    console.error('Error generating Google Auth URL:', error);
    res.status(500).json({ 
      success: false, 
      message: 'ไม่สามารถสร้าง URL สำหรับ Login ด้วย Google ได้' 
    });
  }
});

/**
 * GET /auth/google/callback
 * Callback หลังจาก Login ด้วย Google สำเร็จ
 */
router.get('/google/callback', async (req, res) => {
  const pool = req.pool;
  const { code, error: googleError, state } = req.query;

  if (googleError) {
    console.error('Google OAuth Error:', googleError);
    const frontendCallback = process.env.GOOGLE_OAUTH_FRONTEND_CALLBACK || 'http://localhost:5173/auth/google/callback';
    return res.redirect(`${frontendCallback}?error=${encodeURIComponent('การเข้าสู่ระบบด้วย Google ถูกยกเลิก')}`);
  }

  if (!code) {
    const frontendCallback = process.env.GOOGLE_OAUTH_FRONTEND_CALLBACK || 'http://localhost:5173/auth/google/callback';
    return res.redirect(`${frontendCallback}?error=${encodeURIComponent('ไม่ได้รับรหัสยืนยันจาก Google')}`);
  }

  try {
    // แลกเปลี่ยน code กับข้อมูลผู้ใช้
    const googleUser = await googleOAuthService.getGoogleUserFromCode(code);
    console.log('Google User:', googleUser);

    // ค้นหาการผูกบัญชี Google
    const googleOAuth = await googleOAuthService.findGoogleOAuthByGoogleId(pool, googleUser.googleId);

    const frontendCallback = process.env.GOOGLE_OAUTH_FRONTEND_CALLBACK || 'http://localhost:5173/auth/google/callback';

    // ถ้ามี state (JWT token) แสดงว่าผู้ใช้ล็อกอินแล้วต้องการผูกบัญชี
    if (state && !googleOAuth) {
      try {
        // ตรวจสอบและถอดรหัส JWT token จาก state
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(state, process.env.JWT_SECRET);
        
        // ผูกบัญชี Google กับผู้ใช้ที่ล็อกอินอยู่
        const userId = decoded.userId || decoded.id;
        const userType = decoded.usertype;
        
        if (userType === 'Admin' || userType === 'Super Admin') {
          await googleOAuthService.linkGoogleToAdmin(pool, googleUser, userId);
        } else if (userType === 'Officer') {
          await googleOAuthService.linkGoogleToOfficer(pool, googleUser, userId);
        } else {
          throw new Error('ประเภทผู้ใช้ไม่ถูกต้อง');
        }
        
        // Redirect กลับไปหน้าจัดการบัญชีพร้อมข้อความสำเร็จ
        return res.redirect(`http://project.3bbddns.com:36144/managegoogleaccount?linked=success`);
        
      } catch (err) {
        console.error('Error linking with state:', err);
        return res.redirect(`${frontendCallback}?error=${encodeURIComponent('ไม่สามารถผูกบัญชีได้: ' + err.message)}`);
      }
    }

    if (!googleOAuth) {
      // ยังไม่ได้ผูกบัญชี - ส่งข้อมูล Google กลับไปเพื่อให้ Frontend แสดงหน้าผูกบัญชี
      const googleData = encodeURIComponent(JSON.stringify({
        googleId: googleUser.googleId,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture
      }));
      return res.redirect(`${frontendCallback}?needLink=true&googleData=${googleData}`);
    }

    // ดึงข้อมูลผู้ใช้จากการผูกบัญชี
    const userData = await googleOAuthService.getUserFromGoogleOAuth(pool, googleOAuth);

    if (!userData) {
      return res.redirect(`${frontendCallback}?error=${encodeURIComponent('ไม่พบข้อมูลผู้ใช้ที่ผูกกับบัญชี Google นี้')}`);
    }

    // สร้าง JWT Token
    const token = googleOAuthService.createJwtToken(userData.userId, userData.usertype);

    // Redirect กลับไป Frontend พร้อม Token
    const userInfoEncoded = encodeURIComponent(JSON.stringify(userData.userInfo));
    return res.redirect(
      `${frontendCallback}?token=${token}&usertype=${encodeURIComponent(userData.usertype)}&userInfo=${userInfoEncoded}`
    );

  } catch (error) {
    console.error('Google OAuth Callback Error:', error);
    const frontendCallback = process.env.GOOGLE_OAUTH_FRONTEND_CALLBACK || 'http://localhost:5173/auth/google/callback';
    return res.redirect(`${frontendCallback}?error=${encodeURIComponent(error.message || 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ')}`);
  }
});

/**
 * POST /auth/google/verify
 * ตรวจสอบ ID Token จาก Frontend (สำหรับ One-Tap หรือ Sign-In Button)
 */
router.post('/google/verify', async (req, res) => {
  const pool = req.pool;
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ success: false, message: 'ต้องระบุ ID Token' });
  }

  try {
    // ตรวจสอบ ID Token
    const googleUser = await googleOAuthService.verifyGoogleIdToken(idToken);

    // ค้นหาการผูกบัญชี Google
    const googleOAuth = await googleOAuthService.findGoogleOAuthByGoogleId(pool, googleUser.googleId);

    if (!googleOAuth) {
      // ยังไม่ได้ผูกบัญชี
      return res.status(200).json({
        success: true,
        needLink: true,
        googleUser: {
          googleId: googleUser.googleId,
          email: googleUser.email,
          name: googleUser.name,
          picture: googleUser.picture
        }
      });
    }

    // ดึงข้อมูลผู้ใช้จากการผูกบัญชี
    const userData = await googleOAuthService.getUserFromGoogleOAuth(pool, googleOAuth);

    if (!userData) {
      return res.status(404).json({ 
        success: false, 
        message: 'ไม่พบข้อมูลผู้ใช้ที่ผูกกับบัญชี Google นี้' 
      });
    }

    // สร้าง JWT Token
    const token = googleOAuthService.createJwtToken(userData.userId, userData.usertype);

    return res.status(200).json({
      success: true,
      message: 'Login Successful',
      token: token,
      userInfo: userData.userInfo,
      usertype: userData.usertype,
      role: userData.usertype
    });

  } catch (error) {
    console.error('Google Token Verify Error:', error);
    return res.status(401).json({ 
      success: false, 
      message: error.message || 'ID Token ไม่ถูกต้อง' 
    });
  }
});

/**
 * POST /auth/google/link
 * ผูกบัญชี Google กับบัญชีผู้ใช้ (ต้อง Login ด้วย ID/Password ก่อน)
 */
router.post('/google/link', (req, res, next) => authenticateToken(req, res, () => {
  const pool = req.pool;
  const { googleId, email, name, picture } = req.body;
  const { userId, role } = req.user;

  if (!googleId || !email) {
    return res.status(400).json({ 
      success: false, 
      message: 'ต้องระบุข้อมูล Google Account' 
    });
  }

  (async () => {
    try {
      const googleUser = { googleId, email, name, picture };

      if (role === 'Super Admin' || role === 'Admin') {
        await googleOAuthService.linkGoogleToAdmin(pool, googleUser, userId);
      } else if (role === 'Officer') {
        await googleOAuthService.linkGoogleToOfficer(pool, googleUser, userId);
      } else {
        return res.status(400).json({ 
          success: false, 
          message: 'ประเภทผู้ใช้ไม่รองรับการผูกบัญชี Google' 
        });
      }

      return res.status(200).json({
        success: true,
        message: 'ผูกบัญชี Google เรียบร้อยแล้ว'
      });

    } catch (error) {
      console.error('Google Link Error:', error);
      return res.status(400).json({ 
        success: false, 
        message: error.message || 'ไม่สามารถผูกบัญชี Google ได้' 
      });
    }
  })();
}));

/**
 * POST /auth/google/link-with-credentials
 * ผูกบัญชี Google โดยใช้ ID/Password ยืนยัน (สำหรับกรณียังไม่ได้ Login)
 */
router.post('/google/link-with-credentials', async (req, res) => {
  const pool = req.pool;
  const { id, password, googleId, email, name, picture } = req.body;

  if (!id || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'ต้องระบุ ID และ Password' 
    });
  }

  if (!googleId || !email) {
    return res.status(400).json({ 
      success: false, 
      message: 'ต้องระบุข้อมูล Google Account' 
    });
  }

  try {
    // ตรวจสอบ ID/Password กับ AdminUsers ก่อน
    const [admins] = await pool.execute(
      'SELECT AdminUserID, AdminName, AdminEmail, AdminPassword, ParentAdminID FROM AdminUsers WHERE AdminUserID = ? AND AdminPassword = ?',
      [id, password]
    );

    if (admins && admins.length > 0) {
      const user = admins[0];
      const googleUser = { googleId, email, name, picture };
      
      await googleOAuthService.linkGoogleToAdmin(pool, googleUser, user.AdminUserID);

      // สร้าง Token
      let usertype = 'Admin';
      if (user.ParentAdminID && Number(user.ParentAdminID) === Number(user.AdminUserID)) {
        usertype = 'Super Admin';
      }
      const token = googleOAuthService.createJwtToken(user.AdminUserID, usertype);

      return res.status(200).json({
        success: true,
        message: 'ผูกบัญชี Google และเข้าสู่ระบบเรียบร้อยแล้ว',
        token: token,
        userInfo: user,
        usertype: usertype,
        role: usertype
      });
    }

    // ตรวจสอบกับ Officers
    const [officers] = await pool.execute(
      'SELECT OfficerID, OfficerName, Email AS OfficerEmail, OfficerPassword, OrgID FROM Officers WHERE OfficerID = ? AND OfficerPassword = ?',
      [id, password]
    );

    if (officers && officers.length > 0) {
      const user = officers[0];
      const googleUser = { googleId, email, name, picture };
      
      await googleOAuthService.linkGoogleToOfficer(pool, googleUser, user.OfficerID);

      // Enrich with OrgName
      try {
        if (user.OrgID) {
          const [orgRows] = await pool.query('SELECT OrgName FROM Organizations WHERE OrgID = ? LIMIT 1', [user.OrgID]);
          if (orgRows && orgRows.length > 0) user.OrgName = orgRows[0].OrgName;
        }
      } catch (e) {
        console.warn('Could not enrich user with OrgName:', e && (e.message || e));
      }

      const token = googleOAuthService.createJwtToken(user.OfficerID, 'Officer');

      return res.status(200).json({
        success: true,
        message: 'ผูกบัญชี Google และเข้าสู่ระบบเรียบร้อยแล้ว',
        token: token,
        userInfo: user,
        usertype: 'Officer',
        role: 'Officer'
      });
    }

    // ไม่พบผู้ใช้
    return res.status(401).json({ 
      success: false, 
      message: 'ID หรือ Password ไม่ถูกต้อง' 
    });

  } catch (error) {
    console.error('Google Link with Credentials Error:', error);
    return res.status(400).json({ 
      success: false, 
      message: error.message || 'ไม่สามารถผูกบัญชี Google ได้' 
    });
  }
});

/**
 * DELETE /auth/google/unlink
 * ยกเลิกการผูกบัญชี Google (ต้อง Login อยู่)
 */
router.delete('/google/unlink', (req, res, next) => authenticateToken(req, res, async () => {
  const pool = req.pool;
  const { userId, role } = req.user;

  try {
    await googleOAuthService.unlinkGoogleAccount(pool, role, userId);

    return res.status(200).json({
      success: true,
      message: 'ยกเลิกการผูกบัญชี Google เรียบร้อยแล้ว'
    });

  } catch (error) {
    console.error('Google Unlink Error:', error);
    return res.status(400).json({ 
      success: false, 
      message: error.message || 'ไม่สามารถยกเลิกการผูกบัญชี Google ได้' 
    });
  }
}));

/**
 * GET /auth/google/status
 * ดึงสถานะการผูกบัญชี Google ของผู้ใช้ปัจจุบัน
 */
router.get('/google/status', (req, res, next) => authenticateToken(req, res, async () => {
  const pool = req.pool;
  const { userId, role } = req.user;

  try {
    const status = await googleOAuthService.getGoogleLinkStatus(pool, role, userId);

    return res.status(200).json({
      success: true,
      ...status
    });

  } catch (error) {
    console.error('Google Status Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'ไม่สามารถดึงสถานะการผูกบัญชี Google ได้' 
    });
  }
}));

module.exports = router;
