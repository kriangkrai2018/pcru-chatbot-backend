/**
 * Google OAuth Service
 * บริการจัดการ Google OAuth Login และการผูกบัญชี
 */

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');

// ตรวจสอบ JWT_SECRET
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('ERROR: JWT_SECRET environment variable is not defined.');
}

/**
 * สร้าง Google OAuth2 Client
 */
function getGoogleClient() {
  return new OAuth2Client(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

/**
 * สร้าง URL สำหรับ Login ด้วย Google
 * @param {string} state - Optional state parameter (e.g., JWT token for linking)
 */
function getGoogleAuthUrl(state = null) {
  const client = getGoogleClient();
  const authUrlOptions = {
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: 'select_account'
  };
  
  if (state) {
    authUrlOptions.state = state;
  }
  
  return client.generateAuthUrl(authUrlOptions);
}

/**
 * แลกเปลี่ยน Authorization Code กับ Tokens และดึงข้อมูลผู้ใช้
 */
async function getGoogleUserFromCode(code) {
  const client = getGoogleClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Verify ID token and get user info
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_OAUTH_CLIENT_ID
  });
  
  const payload = ticket.getPayload();
  
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    emailVerified: payload.email_verified
  };
}

/**
 * ตรวจสอบ ID Token จาก Frontend (สำหรับ One-Tap หรือ Sign-In Button)
 */
async function verifyGoogleIdToken(idToken) {
  const client = getGoogleClient();
  
  const ticket = await client.verifyIdToken({
    idToken: idToken,
    audience: process.env.GOOGLE_OAUTH_CLIENT_ID
  });
  
  const payload = ticket.getPayload();
  
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    emailVerified: payload.email_verified
  };
}

/**
 * ค้นหาการผูกบัญชี Google จาก Google ID
 */
async function findGoogleOAuthByGoogleId(pool, googleId) {
  const [rows] = await pool.query(
    'SELECT * FROM GoogleOAuth WHERE GoogleID = ? AND IsActive = 1',
    [googleId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * ค้นหาการผูกบัญชี Google จาก AdminUserID
 */
async function findGoogleOAuthByAdminId(pool, adminUserId) {
  const [rows] = await pool.query(
    'SELECT * FROM GoogleOAuth WHERE AdminUserID = ? AND IsActive = 1',
    [adminUserId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * ค้นหาการผูกบัญชี Google จาก OfficerID
 */
async function findGoogleOAuthByOfficerId(pool, officerId) {
  const [rows] = await pool.query(
    'SELECT * FROM GoogleOAuth WHERE OfficerID = ? AND IsActive = 1',
    [officerId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * ดึงข้อมูลผู้ใช้ (Admin หรือ Officer) จากการผูกบัญชี Google
 */
async function getUserFromGoogleOAuth(pool, googleOAuth) {
  if (googleOAuth.UserType === 'admin') {
    const [admins] = await pool.query(
      `SELECT AdminUserID, AdminName, AdminEmail, ParentAdminID 
       FROM AdminUsers WHERE AdminUserID = ?`,
      [googleOAuth.AdminUserID]
    );
    
    if (admins.length === 0) return null;
    
    const user = admins[0];
    // Determine usertype: Super Admin if ParentAdminID equals AdminUserID
    let usertype = 'Admin';
    if (user.ParentAdminID && Number(user.ParentAdminID) === Number(user.AdminUserID)) {
      usertype = 'Super Admin';
    }
    
    return {
      userId: user.AdminUserID,
      userName: user.AdminName,
      userEmail: user.AdminEmail,
      usertype: usertype,
      userInfo: user
    };
  } else if (googleOAuth.UserType === 'officer') {
    const [officers] = await pool.query(
      `SELECT o.OfficerID, o.OfficerName, o.Email, o.OrgID, org.OrgName
       FROM Officers o
       LEFT JOIN Organizations org ON o.OrgID = org.OrgID
       WHERE o.OfficerID = ?`,
      [googleOAuth.OfficerID]
    );
    
    if (officers.length === 0) return null;
    
    const user = officers[0];
    user.OfficerEmail = user.Email;
    
    return {
      userId: user.OfficerID,
      userName: user.OfficerName,
      userEmail: user.Email,
      usertype: 'Officer',
      userInfo: user
    };
  }
  
  return null;
}

/**
 * สร้าง JWT Token
 */
function createJwtToken(userId, usertype) {
  const payload = {
    userId: userId,
    role: usertype
  };
  
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h'
  });
}

/**
 * ผูกบัญชี Google กับ Admin User
 */
async function linkGoogleToAdmin(pool, googleUser, adminUserId) {
  // ตรวจสอบว่า Admin มีอยู่จริงหรือไม่
  const [admins] = await pool.query(
    'SELECT AdminUserID FROM AdminUsers WHERE AdminUserID = ?',
    [adminUserId]
  );
  
  if (admins.length === 0) {
    throw new Error('ไม่พบผู้ใช้งานที่ต้องการผูกบัญชี');
  }
  
  // ตรวจสอบว่า Admin นี้ผูกกับ Google อื่นอยู่แล้วหรือไม่
  const existingAdminLink = await findGoogleOAuthByAdminId(pool, adminUserId);
  if (existingAdminLink) {
    throw new Error('บัญชีนี้ผูกกับ Google อื่นอยู่แล้ว กรุณายกเลิกการผูกบัญชีเดิมก่อน');
  }
  
  // ตรวจสอบว่า Google ID นี้ผูกกับบัญชีอื่นอยู่แล้วหรือไม่
  const existingGoogleLink = await findGoogleOAuthByGoogleId(pool, googleUser.googleId);
  if (existingGoogleLink) {
    throw new Error('บัญชี Google นี้ผูกกับผู้ใช้อื่นอยู่แล้ว');
  }
  
  // สร้างการผูกบัญชีใหม่
  await pool.query(
    `INSERT INTO GoogleOAuth (GoogleID, GoogleEmail, GoogleName, GooglePicture, UserType, AdminUserID, IsActive)
     VALUES (?, ?, ?, ?, 'admin', ?, 1)`,
    [googleUser.googleId, googleUser.email, googleUser.name, googleUser.picture, adminUserId]
  );
  
  return true;
}

/**
 * ผูกบัญชี Google กับ Officer
 */
async function linkGoogleToOfficer(pool, googleUser, officerId) {
  // ตรวจสอบว่า Officer มีอยู่จริงหรือไม่
  const [officers] = await pool.query(
    'SELECT OfficerID FROM Officers WHERE OfficerID = ?',
    [officerId]
  );
  
  if (officers.length === 0) {
    throw new Error('ไม่พบผู้ใช้งานที่ต้องการผูกบัญชี');
  }
  
  // ตรวจสอบว่า Officer นี้ผูกกับ Google อื่นอยู่แล้วหรือไม่
  const existingOfficerLink = await findGoogleOAuthByOfficerId(pool, officerId);
  if (existingOfficerLink) {
    throw new Error('บัญชีนี้ผูกกับ Google อื่นอยู่แล้ว กรุณายกเลิกการผูกบัญชีเดิมก่อน');
  }
  
  // ตรวจสอบว่า Google ID นี้ผูกกับบัญชีอื่นอยู่แล้วหรือไม่
  const existingGoogleLink = await findGoogleOAuthByGoogleId(pool, googleUser.googleId);
  if (existingGoogleLink) {
    throw new Error('บัญชี Google นี้ผูกกับผู้ใช้อื่นอยู่แล้ว');
  }
  
  // สร้างการผูกบัญชีใหม่
  await pool.query(
    `INSERT INTO GoogleOAuth (GoogleID, GoogleEmail, GoogleName, GooglePicture, UserType, OfficerID, IsActive)
     VALUES (?, ?, ?, ?, 'officer', ?, 1)`,
    [googleUser.googleId, googleUser.email, googleUser.name, googleUser.picture, officerId]
  );
  
  return true;
}

/**
 * ยกเลิกการผูกบัญชี Google
 */
async function unlinkGoogleAccount(pool, userType, userId) {
  let result;
  
  if (userType === 'admin' || userType === 'Admin' || userType === 'Super Admin') {
    [result] = await pool.query(
      'DELETE FROM GoogleOAuth WHERE AdminUserID = ?',
      [userId]
    );
  } else if (userType === 'officer' || userType === 'Officer') {
    [result] = await pool.query(
      'DELETE FROM GoogleOAuth WHERE OfficerID = ?',
      [userId]
    );
  } else {
    throw new Error('ประเภทผู้ใช้ไม่ถูกต้อง');
  }
  
  if (result.affectedRows === 0) {
    throw new Error('ไม่พบการผูกบัญชี Google');
  }
  
  return true;
}

/**
 * ดึงสถานะการผูกบัญชี Google ของผู้ใช้
 */
async function getGoogleLinkStatus(pool, userType, userId) {
  let googleOAuth = null;
  
  if (userType === 'admin' || userType === 'Admin' || userType === 'Super Admin') {
    googleOAuth = await findGoogleOAuthByAdminId(pool, userId);
  } else if (userType === 'officer' || userType === 'Officer') {
    googleOAuth = await findGoogleOAuthByOfficerId(pool, userId);
  }
  
  if (googleOAuth) {
    return {
      linked: true,
      googleEmail: googleOAuth.GoogleEmail,
      googleName: googleOAuth.GoogleName,
      googlePicture: googleOAuth.GooglePicture,
      linkedAt: googleOAuth.CreatedAt
    };
  }
  
  return {
    linked: false
  };
}

module.exports = {
  getGoogleClient,
  getGoogleAuthUrl,
  getGoogleUserFromCode,
  verifyGoogleIdToken,
  findGoogleOAuthByGoogleId,
  findGoogleOAuthByAdminId,
  findGoogleOAuthByOfficerId,
  getUserFromGoogleOAuth,
  createJwtToken,
  linkGoogleToAdmin,
  linkGoogleToOfficer,
  unlinkGoogleAccount,
  getGoogleLinkStatus
};
