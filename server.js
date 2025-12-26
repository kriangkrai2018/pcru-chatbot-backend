// Generic notifier for questions-answers
function notifyQuestionsAnswersUpdate(data) {
	const message = JSON.stringify({
		type: 'QUESTIONS_ANSWERS_UPDATE',
		timestamp: new Date().toISOString(),
		data: data || {}
	});
	console.log(`📢 Broadcasting questions-answers update to ${wss.clients.size} clients:`, data);
	let sentCount = 0;
	wss.clients.forEach((client) => {
		if (client.readyState === WebSocket.OPEN && (client.channel === 'questions-answers' || client.channel === '/')) {
			client.send(message);
			sentCount++;
		}
	});
	console.log(`✅ Sent WebSocket message to ${sentCount} active clients (questions-answers)`);
}
// server.js (ฉบับแก้ไข)

// 1. นำเข้า Express, dotenv, CORS, MySQL และ Nodemailer
const express = require('express');
const path = require('path');
const cors = require('cors'); 
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer'); // <--- เพิ่ม Nodemailer
const multer = require('multer'); // 1. Import multer
const dotenv = require('dotenv');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const { URL } = require('url');
const fs = require('fs');

// *** สำคัญ: โหลด Environment Variables ก่อนไฟล์อื่นทั้งหมด ***
dotenv.config();

// Tokenizer service auto-start (local only)
const TOKENIZER_HOST = process.env.TOKENIZER_HOST || 'project.3bbddns.com';
const TOKENIZER_PORT = process.env.TOKENIZER_PORT || '36146';
const TOKENIZER_PATH = process.env.TOKENIZER_PATH || '/tokenize';
const TOKENIZER_URL = process.env.TOKENIZER_URL || `http://${TOKENIZER_HOST}:${TOKENIZER_PORT}${TOKENIZER_PATH}`;
const AUTO_START_TOKENIZER = process.env.AUTO_START_TOKENIZER !== 'false';

let tokenizerProc = null;
async function startTokenizerService() {
  if (!AUTO_START_TOKENIZER) {
    console.log('🛑 Auto-start tokenizer disabled via AUTO_START_TOKENIZER=false');
    return;
  }

  try {
    const parsed = new URL(TOKENIZER_URL);
    const host = parsed.hostname;
    const port = parsed.port || TOKENIZER_PORT || '36146';

    // Only auto-start when pointing to local host
    if (host !== '127.0.0.1' && host !== 'project.3bbddns.com') {
      console.log(`ℹ️ Skipping tokenizer auto-start (TOKENIZER_URL points to ${host})`);
      return;
    }

    // Check if the port is already in use (avoid EADDRINUSE from uvicorn)
    const net = require('net');
    const isPortUsed = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port: parseInt(port, 10) });
      let done = false;
      socket.on('connect', () => { done = true; socket.end(); resolve(true); });
      socket.on('error', () => { if (!done) { done = true; resolve(false); } });
      setTimeout(() => { if (!done) { done = true; socket.destroy(); resolve(false); } }, 300);
    });

    if (isPortUsed) {
      console.log(`ℹ️ Tokenizer already running at http://${host}:${port}, skipping auto-start.`);
      return;
    }

    // Avoid duplicate spawns
    if (tokenizerProc && !tokenizerProc.killed) {
      return;
    }

    const venvPython = path.join(__dirname, '.venv', 'bin', 'python3');
    const cmd = fs.existsSync(venvPython) ? venvPython : 'python3';
    const args = [
      '-m',
      'uvicorn',
      'scripts.pythainlp_tokenizer_service:app',
      '--host', host,
      '--port', port
    ];

    console.log(`🚀 Auto-starting PyThaiNLP tokenizer at http://${host}:${port}`);
    console.log(`🔎 Using python: ${cmd}`);
    tokenizerProc = spawn(cmd, args, {
      cwd: __dirname,
      stdio: 'inherit',
    });

    tokenizerProc.on('close', (code, signal) => {
      console.log(`ℹ️ Tokenizer service exited (code=${code}, signal=${signal})`);
    });
    tokenizerProc.on('error', (err) => {
      console.error('❌ Failed to start tokenizer service:', err.message);
    });
  } catch (err) {
    console.error('❌ Tokenizer auto-start error:', err.message);
  }
}

function stopTokenizerService() {
  if (tokenizerProc && !tokenizerProc.killed) {
    tokenizerProc.kill();
  }
}

// นำเข้า Middleware
const authenticateToken = require('./auth'); // แก้ไข path ให้ถูกต้อง

// นำเข้า Service ที่แยกออกมา
const loginService = require('./services/login');
const forgotPasswordService = require('./services/forgotpassword');
const setNewPasswordService = require('./services/setnewpassword');
const validateResetTokenService = require('./services/validateResetToken');
const getAdminUsersService = require('./services/reports/getAdminUsers'); // path ถูกต้องแล้ว
const getOrganizationsService = require('./services/reports/getOrganizations'); // path ถูกต้องแล้ว
const getOfficersService = require('./services/reports/getOfficers'); // path ถูกต้องแล้ว
const getCategoriesService = require('./services/reports/getCategories');
const getCategoriesPublicService = require('./services/public/getCategoriesPublic');
const getKeywordsService = require('./services/reports/getKeywords');
const getKeywordsPublicService = require('./services/public/getKeywordsPublic');
const getFeedbacksService = require('./services/reports/getFeedbacks');
const { markFeedbackHandledService, getHandledFeedbacksService, cleanupHandledFeedbacksService, unhandleFeedbackService } = require('./services/reports/feedbackHandled');
const getAnswersKeywordsService = require('./services/reports/getAnswersKeywords');
const getQuestionsAnswersService = require('./services/reports/getQuestionsAnswers');
const uploadAdminUsersService = require('./services/adminUsers/uploadAdminUsers'); // admin users upload service
const uploadOrganizationsService = require('./services/Organizations/uploadOrganizations'); // organizations upload service
const downloadLastUploadService = require('./services/adminUsers/downloadLastUpload'); // admin users download
const downloadOrganizationsLastUploadService = require('./services/organizations/downloadLastUpload'); // organizations download
const uploadOfficersService = require('./services/Officers/uploadOfficers'); // officers upload service
const downloadOfficersLastUploadService = require('./services/Officers/downloadLastUpload'); // officers download
const getChatLogHasAnswersService = require('./services/reports/getChatLogHasAnswers');
const getChatLogNoAnswersService = require('./services/reports/getChatLogNoAnswers');
const downloadCategoriesLastUploadService = require('./services/Categories/downloadLastUpload'); // categories download service
const uploadCategoriesService = require('./services/Categories/uploadCategories');
const uploadQuestionsAnswersService = require('./services/QuestionsAnswers/uploadQuestionsAnswers');
const downloadQuestionsAnswersLastUploadService = require('./services/QuestionsAnswers/downloadLastUpload');
const downloadLatestExportService = require('./services/QuestionsAnswers/downloadLatestExport');
const chatRespondService = require('./services/chat/respond');
const chatFeedbackService = require('./services/chat/feedback');
const chatLogHasAnswerService = require('./services/chat/logHasAnswer');
const chatLogNoAnswerService = require('./services/chat/logNoAnswer');
const getStopwordsService = require('./services/stopwords/getStopwords');
const addStopwordService = require('./services/stopwords/addStopword');
const deleteStopwordService = require('./services/stopwords/deleteStopword');
const { clearStopwordsCache } = require('./services/stopwords/loadStopwords');
const { clearNegativeKeywordsCache } = require('./services/negativeKeywords/loadNegativeKeywords');
const { syncStopwords } = require('./scripts/sync_stopwords_from_standard');
// Ranking route
const rankingRoute = require('./routes/ranking');

const upload = multer({ dest: 'uploads/' }); // Multer config

const app = express();
// Expose pool globally for background worker usage (lightweight)
try {
  const { pool } = require('./config');
  global.__DB_POOL__ = pool;
} catch (e) {
  // ignore if config structure differs
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3001; 

// Assign after app is initialized
app.locals.notifyQuestionsAnswersUpdate = notifyQuestionsAnswersUpdate;

// Start tokenizer service when server boots (local TOKENIZER_URL only)
startTokenizerService();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const pathName = req && req.url ? req.url : '/';
  // tag the client with a channel derived from path, e.g. /ws/feedbacks
  ws.channel = pathName.startsWith('/ws/') ? pathName.slice(4) : pathName; // e.g. 'feedbacks'
  console.log(`✅ New WebSocket client connected on ${pathName}`);
  
  ws.on('close', () => {
    console.log('❌ WebSocket client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Function to notify all connected clients about feedback updates
function notifyFeedbackUpdate(data) {
  const message = JSON.stringify({
    type: 'FEEDBACK_UPDATE',
    timestamp: new Date().toISOString(),
    data: data || {}
  });
  
  console.log(`📢 Broadcasting feedback update to ${wss.clients.size} clients:`, data);
  
  let sentCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && (client.channel === 'feedbacks' || client.channel === '/')) {
      client.send(message);
      sentCount++;
    }
  });
  
  console.log(`✅ Sent WebSocket message to ${sentCount} active clients`);
}

// Export notifyFeedbackUpdate for use in other modules
app.locals.notifyFeedbackUpdate = notifyFeedbackUpdate;

// Generic notifier for chat logs (has/no answer)
function notifyChatLogsUpdate(data) {
  const message = JSON.stringify({
    type: 'CHATLOGS_UPDATE',
    timestamp: new Date().toISOString(),
    data: data || {}
  });
  console.log(`📢 Broadcasting chat logs update to ${wss.clients.size} clients:`, data);
  let sentCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && (client.channel === 'chat-logs' || client.channel === '/')) {
      client.send(message);
      sentCount++;
    }
  });
  console.log(`✅ Sent WebSocket message to ${sentCount} active clients (chat-logs)`);
}
app.locals.notifyChatLogsUpdate = notifyChatLogsUpdate;

// Semantic suggestions routes removed

// 2. สร้าง Nodemailer Transporter
// ******* ต้องมี EMAIL_USER และ EMAIL_PASS ในไฟล์ .env *******
// All schedulers and auto-tune features removed
// ใน server.js
const transporter = nodemailer.createTransport({
    service: 'gmail', 
    auth: {
        type: 'OAuth2', // <--- ต้องมีบรรทัดนี้
        user: process.env.EMAIL_USER,
        clientId: process.env.OAUTH_CLIENT_ID,
        clientSecret: process.env.OAUTH_CLIENT_SECRET,
        refreshToken: process.env.OAUTH_REFRESH_TOKEN // <--- ต้องมี Refresh Token
    }
});
console.log('✅ Nodemailer Transporter Initialized.');


// 3. สร้าง MySQL Connection Pool
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT) || 0
});

// ตรวจสอบการเชื่อมต่อฐานข้อมูลเมื่อ Server เริ่มต้น
pool.getConnection()
    .then(async connection => {
        console.log('✅ MySQL Database Connected Successfully!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Failed to connect to MySQL:', err.message);
    });

// Store pool in app.locals for use in routes
app.locals.pool = pool;

// 4. กำหนด Middleware 
// Explicit CORS for frontend dev origins to avoid Safari access-control blocks
const defaultFrontendOrigin = (() => { try { return new URL(process.env.CLIENT_URL || 'http://project.3bbddns.com:5173').origin; } catch (e) { return 'http://project.3bbddns.com:5173'; } })();
const allowedOrigins = [
  defaultFrontendOrigin,
  process.env.FRONTEND_ORIGIN || ''
].filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin (mobile Safari, curl) and allowed dev origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(null, true); // fallback: allow all during local dev
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Session-ID'],
  credentials: false
}));
app.use(express.json());
// add URL-encoded parser (for some form submissions)
app.use(express.urlencoded({ extended: true }));
// parse raw CSV/text bodies so upload endpoint can accept Content-Type: text/csv or text/plain
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '10mb' }));

// Serve frontend helper scripts (helpers will define bindSidebarResize / unbindSidebarResize)
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// Serve frontend static files (if a built frontend exists)
const FRONTEND_DIR = process.env.FRONTEND_STATIC_DIR || path.join(__dirname, '..', 'PCRU-CHATBOT-FRONTEND-1', 'dist');
if (fs.existsSync(FRONTEND_DIR)) {
  console.log(`📦 Serving frontend static files from ${FRONTEND_DIR}`);
  app.use(express.static(FRONTEND_DIR));

  // Prefer explicit API/static routes above; fallback to SPA index for unknown GETs
  // Use a generic middleware instead of a path pattern to avoid path-to-regexp issues
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const skipPrefixes = ['/api', '/uploads', '/js', '/ranking', '/system'];
    for (const p of skipPrefixes) {
      if (req.path.startsWith(p)) return next();
    }
    const indexPath = path.join(FRONTEND_DIR, 'index.html');
    if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
    return next();
  });
} else {
  console.log(`ℹ️ Frontend static directory not found at ${FRONTEND_DIR}; skipping SPA fallback.`);
}
// 5. สร้าง Route 
app.get('/', (req, res) => {
  res.send('PCRU Chatbot Backend running');
});

// Thai patterns routes removed

// --- Public Routes (No Authentication Required) ---
app.post('/login', loginService(pool, transporter));
app.post('/forgotpassword', forgotPasswordService(pool, transporter));
app.post('/setnewpassword', setNewPasswordService(pool));
app.post('/validateresettoken', validateResetTokenService(pool));
// เพิ่ม public categories (ไม่ต้อง auth)
app.get('/categories', getCategoriesPublicService(pool));
app.get('/getcategories', authenticateToken, getCategoriesService(pool));
// Chat respond endpoint (Public)
app.post('/chat/respond', chatRespondService(pool));
// Chat contacts endpoint (Public) - returns relevant officer contacts
app.get('/chat/contacts', async (req, res) => {
  if (!app.locals.pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }
  const q = String(req.query.q || '').toLowerCase();
  try {
    // Infer domain terms from query text
    const scholarshipTerms = ['ทุน','ทุนการศึกษา','ทุนเรียน','ทุนเรียนดี','ทุนช่วยเหลือ','ทุนความสามารถ'];
    const dormTerms = ['หอ','หอพัก'];
    const admissionsTerms = ['สมัคร','รับสมัคร'];
    const containsAny = (terms, text) => terms.some(t => text.includes(t));
    const wantScholarship = containsAny(scholarshipTerms, q);
    const wantDorm = containsAny(dormTerms, q);
    const wantAdmissions = containsAny(admissionsTerms, q);
    const orgTermMap = {
      scholarship: ['ทุน','ทุนการศึกษา','การเงิน'],
      dorm: ['หอ','หอพัก','สวัสดิการ'],
      admissions: ['รับสมัคร','ทะเบียน','วิชาการ']
    };
    const terms = [];
    if (wantScholarship) terms.push(...orgTermMap.scholarship);
    if (wantDorm) terms.push(...orgTermMap.dorm);
    if (wantAdmissions) terms.push(...orgTermMap.admissions);

    let rows = [];
    if (terms.length > 0) {
      const likes = terms.map(t => `%${t}%`);
      const ors = terms.map(() => 'org.OrgName LIKE ?').join(' OR ');
      const [rowsData] = await app.locals.pool.query(
        `SELECT o.OfficerID, o.OfficerName AS officer, o.OfficerPhone AS phone, org.OrgName AS organization
         FROM Officers o
         LEFT JOIN Organizations org ON o.OrgID = org.OrgID
         WHERE (${ors}) AND o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
         ORDER BY org.OrgName ASC LIMIT 10`,
        likes
      );
      rows = rowsData;
    }
    if (!rows || rows.length === 0) {
      const [fallbackRows] = await app.locals.pool.query(
        `SELECT DISTINCT org.OrgName AS organization, o.OfficerName AS officer, o.OfficerPhone AS phone
         FROM Officers o
         LEFT JOIN Organizations org ON o.OrgID = org.OrgID
         WHERE o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
         ORDER BY org.OrgName ASC
         LIMIT 20`
      );
      rows = fallbackRows || [];
    }

    const { formatThaiPhone } = require('./utils/formatPhone');
    // Default contact is sourced from config/DB instead of hardcoding
    const { getDefaultContact } = require('./utils/getDefaultContact');
    const defaultContact = await getDefaultContact(app.locals.pool);

    const contacts = (rows || []).map(r => ({
      organization: r.organization || null,
      officer: r.officer || null,
      phone: r.phone || null,
      officerPhoneRaw: r.phone || null,
      officerPhone: r.phone ? formatThaiPhone(r.phone) : null
    }));

    // Prefer a contact where name matches 'วิพาด' or phone starts with '081' if present
    const findPreferred = (list) => {
      if (!list) return null;
      const nameMatch = list.find(c => /วิพาด/.test(String(c.officer || '')));
      if (nameMatch) return nameMatch;
      const phoneMatch = list.find(c => (c.phone || '').replace(/\D/g,'').startsWith('081'));
      if (phoneMatch) return phoneMatch;
      return null;
    };
    const preferred = findPreferred(contacts);
    if (preferred) { contacts.length = 0; contacts.push(preferred); console.log('Selected preferred contact (server):', preferred); }

    if (!contacts || contacts.length === 0) {
      // Try to find a matching DB contact first
      try {
        const [dbDefault] = await app.locals.pool.query(
          `SELECT o.OfficerPhone AS phone, o.OfficerName AS officer, org.OrgName AS organization
           FROM Officers o
           LEFT JOIN Organizations org ON o.OrgID = org.OrgID
           WHERE (REPLACE(o.OfficerName, '…', '') LIKE ? OR REPLACE(REPLACE(org.OrgName, '\\t', ''), '…', '') LIKE ?) AND o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
           LIMIT 1`, ['%วิพาด%', '%ส่งเสริม%']
        );
        if (dbDefault && dbDefault.length > 0) {
          const r = dbDefault[0];
          contacts.push({
            organization: r.organization || defaultContact?.organization || null,
            officer: r.officer || defaultContact?.officer || null,
            phone: r.phone || defaultContact?.phone || null,
            officerPhoneRaw: r.phone || defaultContact?.officerPhoneRaw || null,
            officerPhone: r.phone ? formatThaiPhone(r.phone) : (defaultContact?.officerPhone || null)
          });
        } else if (defaultContact) {
          contacts.push(defaultContact);
        } else {
          // defaultContact not configured; fallback to officers who authored QAs
          try {
            const [qaOfficers] = await app.locals.pool.query(
              `SELECT DISTINCT o.OfficerID, o.OfficerName AS officer, o.OfficerPhone AS phone, org.OrgName AS organization
               FROM Officers o
               LEFT JOIN Organizations org ON o.OrgID = org.OrgID
               INNER JOIN QuestionsAnswers qa ON qa.OfficerID = o.OfficerID
               WHERE o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
               ORDER BY qa.QuestionsAnswersID DESC
               LIMIT 5`
            );
            const fromQa = (qaOfficers || []).map(r => ({ organization: r.organization || null, officer: r.officer || null, phone: r.phone || null, officerPhoneRaw: r.phone || null, officerPhone: r.phone ? formatThaiPhone(r.phone) : null })).filter(Boolean);
            if (fromQa.length > 0) contacts.push(...fromQa);
          } catch (e) {
            console.error('Error fetching QA officers for contacts fallback (server):', e && e.message);
          }
        }
      } catch (e) {
        console.error('Error fetching default contact from DB', e && (e.message || e));
        contacts.push(defaultContact);
      }
    }
    // Deduplicate by officer+phone
    const dedup = [];
    const seen = new Set();
    for (const c of contacts) {
      const key = `${c.officer || ''}::${c.phone || ''}`;
      if (!seen.has(key)) { seen.add(key); dedup.push(c); }
    }
    return res.status(200).json({ success: true, contacts: dedup });
  } catch (err) {
    console.error('GET /chat/contacts error:', err && err.message);
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


// --- Protected Routes (Authentication Required) ---
// ใช้ authenticateToken middleware กับทุก route ที่อยู่ข้างใต้กลุ่มนี้
app.get('/adminusers', authenticateToken, getAdminUsersService(pool));
app.get('/organizations', authenticateToken, getOrganizationsService(pool));
app.get('/officers', authenticateToken, getOfficersService(pool));
// ยังคงเวอร์ชัน protected ไว้สำหรับผู้ใช้ที่ต้องการข้อมูลภายใต้สิทธิ์
app.get('/categories_protected', authenticateToken, getCategoriesService(pool));
// Public keywords endpoint for stopwords management UI (distinct KeywordText)
app.get('/keywords/public', getKeywordsPublicService(pool));
// Protected keywords endpoint
app.get('/keywords', authenticateToken, getKeywordsService(pool));
app.get('/feedbacks', authenticateToken, getFeedbacksService(pool));
app.get('/feedbacks/handled', authenticateToken, getHandledFeedbacksService(pool));
app.put('/feedbacks/:feedbackId/handle', authenticateToken, markFeedbackHandledService(pool));
app.put('/feedbacks/:feedbackId/unhandle', authenticateToken, unhandleFeedbackService(pool));
app.delete('/feedbacks/cleanup-handled', authenticateToken, cleanupHandledFeedbacksService(pool));
app.get('/answerskeywords', authenticateToken, getAnswersKeywordsService(pool));
app.get('/questionsanswers', authenticateToken, getQuestionsAnswersService(pool));
app.get('/chatloghasanswers', authenticateToken, getChatLogHasAnswersService(pool));
app.get('/chatlognoanswers', authenticateToken, getChatLogNoAnswersService(pool));

// --- Legacy / alternate endpoint aliases (to avoid 404s from frontend expecting different routes) ---
app.get('/getCategories_protected', authenticateToken, getCategoriesService(pool));
app.get('/getKeywords', authenticateToken, getKeywordsService(pool));
app.get('/getFeedbacks', authenticateToken, getFeedbacksService(pool));
app.get('/getAnswersKeywords', authenticateToken, getAnswersKeywordsService(pool));
app.get('/getQuestionsAnswers', authenticateToken, getQuestionsAnswersService(pool));
app.get('/getChatLogHasAnswers', authenticateToken, getChatLogHasAnswersService(pool));
app.get('/getChatLogNoAnswers', authenticateToken, getChatLogNoAnswersService(pool));

// --- Stopwords Management ---
// Public list endpoint for viewing in UI without auth
app.get('/stopwords/public', getStopwordsService(pool));
// Protected list (legacy/for authenticated use)
app.get('/stopwords', authenticateToken, getStopwordsService(pool));
app.post('/stopwords', authenticateToken, async (req, res) => {
  await addStopwordService(pool)(req, res);
  clearStopwordsCache(); // Clear cache after adding
});
app.delete('/stopwords/:id', authenticateToken, async (req, res) => {
  await deleteStopwordService(pool)(req, res);
  clearStopwordsCache(); // Clear cache after deleting
});

// --- Negative Keywords CRUD Management ---
const negativeKeywordsCrudRoutes = require('./routes/negativeKeywordsCrud');
app.use('/negativekeywords', authenticateToken, negativeKeywordsCrudRoutes(pool));

// --- Admin Keyword Management ---
const adminRoutes = require('./routes/admin');
app.use('/admin', authenticateToken, adminRoutes); // 🔐 Protected with authenticateToken

// Thai patterns routes removed

// --- Keywords Management (cleanup/suggestions) ---
const keywordsRoutes = require('./routes/keywords');
app.use('/keywords', authenticateToken, keywordsRoutes); // 🔐 Protected with authenticateToken

// --- Categories CRUD (เพิ่ม แก้ไข ลบ หมวดหมู่) ---
const categoriesCrudRoutes = require('./routes/categoriesCrud');
app.use('/categories/crud', authenticateToken, categoriesCrudRoutes);

// --- Officers CRUD (เพิ่ม แก้ไข ลบ เจ้าหน้าที่) ---
const officersCrudRoutes = require('./routes/officersCrud');
app.use('/officers/crud', authenticateToken, officersCrudRoutes);

// --- Officers Upload/Download (CSV) ---
app.post('/officers/upload', authenticateToken, upload.single('file'), uploadOfficersService(pool));
app.get('/officers/last-upload', authenticateToken, downloadOfficersLastUploadService());

// --- Organizations Upload/Download (CSV) ---
app.post('/organizations/upload', authenticateToken, upload.single('file'), uploadOrganizationsService(pool));
app.get('/organizations/last-upload', authenticateToken, downloadOrganizationsLastUploadService());

// --- Admin Users Upload/Download (CSV) ---
app.post('/adminusers/upload', authenticateToken, upload.single('file'), uploadAdminUsersService(pool));
app.get('/adminusers/last-upload', authenticateToken, downloadLastUploadService());

// --- Organizations CRUD (เพิ่ม แก้ไข ลบ หน่วยงาน) ---
const organizationsCrudRoutes = require('./routes/organizationsCrud');
app.use('/organizations/crud', authenticateToken, organizationsCrudRoutes);

// --- AdminUsers CRUD (เพิ่ม แก้ไข ลบ ผู้ดูแลระบบ) ---
const adminUsersCrudRoutes = require('./routes/adminUsersCrud');
app.use('/adminusers', authenticateToken, adminUsersCrudRoutes);

// --- Keyword Synonyms CRUD (คำพ้อง/คำสนับสนุน) ---
const synonymsCrudRoutes = require('./routes/synonymsCrud');
app.use('/synonyms', authenticateToken, synonymsCrudRoutes(pool));

// --- QuestionsAnswers CRUD (เพิ่ม แก้ไข ลบ ง่ายๆ) ---
const questionsAnswersCrudRoutes = require('./routes/questionsAnswersCrud');

// --- AI Image Management (Admin only) ---
const aiImageRoutes = require('./routes/aiImageCrud');
app.use('/ai-image', aiImageRoutes); // Public GET for chatbot, protected POST/DELETE via internal logic
// Serve uploaded AI images with explicit CORS
app.use('/uploads/ai-images', cors(), express.static(path.join(__dirname, 'uploads', 'ai-images')));

// Public endpoint: categories (no auth required)
app.get('/questionsanswers/categories', async (req, res) => {
  if (!app.locals.pool) {
    return res.status(500).json({ success: false, message: 'Database pool not available' });
  }
  try {
    const [categories] = await app.locals.pool.query(
      'SELECT CategoriesID, CategoriesName FROM Categories ORDER BY CategoriesName'
    );
    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});
// Protected endpoints: create, update, delete (auth required)
app.use('/questionsanswers', authenticateToken, questionsAnswersCrudRoutes);

// Explicit public fallback with logging (calls service handler directly)
app.get('/getChatLogHasAnswers', async (req, res) => {
	console.log('[fallback] GET /getChatLogHasAnswers called, auth present=', !!req.headers.authorization);
	try {
		await getChatLogHasAnswersService(pool)(req, res);
	} catch (e) {
		console.error('[fallback] getChatLogHasAnswers error:', e);
		res.status(500).json({ success: false, message: 'Internal Server Error' });
	}
});

app.get('/getChatLogNoAnswers', async (req, res) => {
	console.log('[fallback] GET /getChatLogNoAnswers called, auth present=', !!req.headers.authorization);
	try {
		await getChatLogNoAnswersService(pool)(req, res);
	} catch (e) {
		console.error('[fallback] getChatLogNoAnswers error:', e);
		res.status(500).json({ success: false, message: 'Internal Server Error' });
	}
});

// Also provide lowercase/alternative forms if frontend uses different casing
app.get('/getchatloghasanswers', authenticateToken, getChatLogHasAnswersService(pool));
app.get('/getchatlognoanswers', authenticateToken, getChatLogNoAnswersService(pool));

// Public (no-auth) legacy aliases to prevent 404s when frontend requests legacy routes without Authorization
app.get('/getChatLogNoAnswers', getChatLogNoAnswersService(pool));
app.get('/getChatLogHasAnswers', getChatLogHasAnswersService(pool));
app.get('/getchatlognoanswers', getChatLogNoAnswersService(pool));
app.get('/getchatloghasanswers', getChatLogHasAnswersService(pool));

// --- Upload Routes ---
app.post('/adminusers/upload', authenticateToken, upload.single('file'), uploadAdminUsersService(pool));
app.post('/organizations/upload', authenticateToken, upload.any(), uploadOrganizationsService(pool));
app.post('/officers/upload', authenticateToken, upload.any(), uploadOfficersService(pool));
app.post('/categories/upload', authenticateToken, upload.any(), uploadCategoriesService(pool));
app.post('/questionsanswers/upload', authenticateToken, upload.any(), uploadQuestionsAnswersService(pool));
app.get('/questionsanswers/download-latest', authenticateToken, (req, res) => downloadLatestExportService(req, res, pool));

// Chat feedback endpoint (public)
app.post('/chat/feedback', chatFeedbackService(pool));
app.post('/chat/logs/has-answer', chatLogHasAnswerService(pool));
app.post('/chat/logs/no-answer', chatLogNoAnswerService(pool));

// Ranking API (public)
app.use('/ranking', rankingRoute);

// --- System Information Route (public) ---
const systemRoute = require('./routes/system');
app.use('/system', systemRoute(pool));

// --- Download Routes ---
app.get('/adminusers/last-upload', authenticateToken, downloadLastUploadService());
app.get('/organizations/last-upload', authenticateToken, downloadOrganizationsLastUploadService());
app.get('/officers/last-upload', authenticateToken, downloadOfficersLastUploadService());
app.get('/categories/last-upload', authenticateToken, downloadCategoriesLastUploadService());
app.get('/questionsanswers/last-upload', authenticateToken, downloadQuestionsAnswersLastUploadService());

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled Server Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    detail: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 7. เปิด Server
const HOST = process.env.HOST || 'project.3bbddns.com';
server.listen(PORT, HOST, async () => {
  // List non-internal IPv4 addresses for convenience when binding to 0.0.0.0
  const os = require('os');
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  if (HOST === '0.0.0.0' && addrs.length > 0) {
    console.log(`Server listening on ${HOST}:${PORT} (accessible via: ${addrs.map(a => `http://${a}:${PORT}`).join(', ')})`);
  } else {
    console.log(`Server running at http://${HOST}:${PORT}`);
  }
  console.log(`WebSocket server running at ws://${HOST}:${PORT}`);
  
  // Auto-sync stopwords on server start
  console.log('🔄 Starting stopwords auto-sync...');
  try {
    await syncStopwords(pool);
  } catch (err) {
    console.error('⚠️  Stopwords auto-sync failed:', err.message);
    // Continue server startup even if sync fails
  }
});

// Graceful shutdown
function shutdown() {
  stopTokenizerService();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);