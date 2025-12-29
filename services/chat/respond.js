const { getStopwordsSet } = require('../stopwords/loadStopwords');
const NEG_KW_MODULE = require('../negativeKeywords/loadNegativeKeywords');

// Extract functions safely to avoid errors if module structure differs
const simpleTokenize = NEG_KW_MODULE.simpleTokenize || ((t) => String(t || '').toLowerCase().split(/\s+/));
const analyzeQueryNegation = NEG_KW_MODULE.analyzeQueryNegation || (() => ({ hasNegation: false, negatedKeywords: [] }));
const checkNegation = NEG_KW_MODULE.checkNegation || (() => ({ isNegated: false }));
const getNegativeKeywordsMap = NEG_KW_MODULE.getNegativeKeywordsMap || (() => ({}));
const INLINE_NEGATION_PATTERNS = NEG_KW_MODULE.INLINE_NEGATION_PATTERNS || [];
const { calculateFinalRanking } = require('../ranking/calculateFinalRanking');

// --- Global Caches ---
let SEMANTIC_SIM_MAP = {};
let getSemanticSimilarity = (a, b) => 0;
let SYNONYMS_MAPPING = {};
const BOT_PRONOUN = process.env.BOT_PRONOUN || 'หนู';
const NEGATION_BLOCKS = new Map();

// --- Configuration ---
const KW_SIM_THRESHOLD = parseFloat(process.env.KW_SIM_THRESHOLD) || 0.5;
const TOKENIZER_HOST = process.env.TOKENIZER_HOST || 'project.3bbddns.com';
const TOKENIZER_PORT = process.env.TOKENIZER_PORT || '36146';
const TOKENIZER_PATH = process.env.TOKENIZER_PATH || '/tokenize';
const TOKENIZER_URL = process.env.TOKENIZER_URL || `http://${TOKENIZER_HOST}:${TOKENIZER_PORT}${TOKENIZER_PATH}`;

// --------------------------------------------------------------------------------
// HELPER FUNCTIONS (Defined BEFORE usage)
// --------------------------------------------------------------------------------

async function fetchQAWithKeywords(connection) {
  const [rows] = await connection.query(`
    SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.ReviewDate, qa.QuestionText, qa.OfficerID,
           c.CategoriesName AS CategoriesID, c.CategoriesPDF
    FROM QuestionsAnswers qa
    LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
  `);
  const result = [];
  for (const row of rows) {
    const [keywords] = await connection.query(`
      SELECT k.KeywordText
      FROM Keywords k
      INNER JOIN AnswersKeywords ak ON k.KeywordID = ak.KeywordID
      WHERE ak.QuestionsAnswersID = ?`, [row.QuestionsAnswersID]);
    result.push({ ...row, keywords: (keywords || []).map(k => k.KeywordText) });
  }
  return result;
}

function getSessionKey(req) {
  try {
    if (!req) return 'anonymous';
    const sid = (req.session && (req.session.id || req.sessionID)) ? (req.session.id || req.sessionID) : null;
    if (sid) return String(sid);
    if (req.ip) return String(req.ip);
    return 'anonymous';
  } catch (e) { return 'anonymous'; }
}

function loadBlockedDomains(req) {
  try {
    const s = (req && req.session && req.session.blockedDomains) ? req.session.blockedDomains : [];
    return new Set(Array.isArray(s) ? s : []);
  } catch (e) { return new Set(); }
}

function loadBlockedKeywords(req) {
  try {
    const s = (req && req.session && req.session.blockedKeywords) ? req.session.blockedKeywords : [];
    return new Set(Array.isArray(s) ? s : []);
  } catch (e) { return new Set(); }
}

function clearBlockedDomains(req) {
  try {
    if (req && req.session) {
      req.session.blockedDomains = [];
      req.session.blockedKeywords = [];
    }
  } catch (e) { }
}

function persistBlockedKeywords(req, keywords) {
  try {
    if (!Array.isArray(keywords)) return;
    const existing = loadBlockedKeywords(req);
    const combined = new Set([...(existing || []), ...keywords.map(k => String(k).toLowerCase())]);
    if (req && req.session) req.session.blockedKeywords = Array.from(combined);
    const key = getSessionKey(req);
    const entry = NEGATION_BLOCKS.get(key) || { blockedDomains: new Set(), blockedKeywords: new Set(), updatedAt: 0 };
    entry.blockedKeywords = new Set(Array.from(entry.blockedKeywords || []).concat(Array.from(combined)));
    entry.updatedAt = Date.now();
    NEGATION_BLOCKS.set(key, entry);
  } catch (e) { console.warn('persistBlockedKeywords failed', e && (e.message || e)); }
}

function persistBlockedDomains(req, domains) {
  try {
    if (!Array.isArray(domains)) return;
    const existing = loadBlockedDomains(req);
    const combined = new Set([...(existing || []), ...domains.map(d => String(d).toLowerCase())]);
    if (req && req.session) req.session.blockedDomains = Array.from(combined);
    const key = getSessionKey(req);
    const entry = NEGATION_BLOCKS.get(key) || { blockedDomains: new Set(), blockedKeywords: new Set(), updatedAt: 0 };
    entry.blockedDomains = new Set(Array.from(entry.blockedDomains || []).concat(Array.from(combined)));
    entry.updatedAt = Date.now();
    NEGATION_BLOCKS.set(key, entry);
  } catch (e) { console.warn('persistBlockedDomains failed', e && (e.message || e)); }
}

function resolveSynonyms(tokens) {
  if (!Array.isArray(tokens)) return tokens;
  try {
    return tokens.map(t => {
      const k = String(t || '').toLowerCase().trim();
      if (SYNONYMS_MAPPING && SYNONYMS_MAPPING[k]) return SYNONYMS_MAPPING[k];
      return t;
    });
  } catch (e) { return tokens; }
}

async function loadSemanticData(pool) {
  try {
    const loader = require('../semanticData/loadSemanticData');
    const map = await loader.getSemanticSimilarity(pool);
    SEMANTIC_SIM_MAP = map || {};
    getSemanticSimilarity = (w1, w2) => {
      try {
        if (!w1 || !w2) return 0;
        if (SEMANTIC_SIM_MAP[w1] && typeof SEMANTIC_SIM_MAP[w1][w2] !== 'undefined') return SEMANTIC_SIM_MAP[w1][w2];
        return 0;
      } catch (e) { return 0; }
    };
    return SEMANTIC_SIM_MAP;
  } catch (e) {
    SEMANTIC_SIM_MAP = {};
    getSemanticSimilarity = () => 0;
    return {};
  }
}

async function loadSynonymsMapping(pool) {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`SELECT s.InputWord AS input, k.KeywordText AS target FROM KeywordSynonyms s JOIN Keywords k ON s.TargetKeywordID = k.KeywordID WHERE s.IsActive = 1`);
    connection.release();
    SYNONYMS_MAPPING = {};
    for (const r of rows || []) {
      if (r && r.input && r.target) SYNONYMS_MAPPING[String(r.input).toLowerCase().trim()] = String(r.target).toLowerCase().trim();
    }
    return SYNONYMS_MAPPING;
  } catch (e) {
    SYNONYMS_MAPPING = {};
    return {};
  }
}

async function tokenizeWithPython(text) {
  if (!TOKENIZER_URL) return null;
  let urlObj;
  try { urlObj = new URL(TOKENIZER_URL); } catch (err) { return null; }
  const payload = JSON.stringify({ text });
  const client = urlObj.protocol === 'https:' ? require('https') : require('http');
  return new Promise((resolve) => {
    const req = client.request({ hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80), path: urlObj.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { const json = JSON.parse(data || '{}'); const tokens = Array.isArray(json.tokens) ? json.tokens : []; const cleaned = tokens.map((t) => String(t || '').trim()).filter(Boolean); resolve(cleaned); } catch (errParse) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(payload);
    req.end();
  });
}

async function normalize(text, pool) {
  try {
    const t = String(text || '').toLowerCase().trim();
    const cleaned = t.replace(/[\p{P}\p{S}]/gu, ' ');
    const separated = cleaned.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
    const stopwords = await getStopwordsSet(pool);
    const shortStopwords = Array.from(stopwords).filter((sw) => sw && sw.length <= 4);
    const sortedStopwords = Array.from(stopwords).sort((a, b) => b.length - a.length);

    const refineTokens = (tokens) => {
      const result = [];
      const queue = [...tokens];
      const seen = new Set();
      let loopCount = 0;
      while (queue.length > 0) {
        if (loopCount++ > 1000) break;
        const tok = queue.shift().trim();
        if (!tok || seen.has(tok)) continue;
        seen.add(tok);
        if (stopwords.has(tok)) continue;
        let splitPerformed = false;
        for (const sw of sortedStopwords) {
          if (!sw) continue;
          if (tok.includes(sw) && tok !== sw) {
            const parts = tok.split(sw).map((p) => p.trim()).filter(Boolean);
            if (parts.length > 0) queue.unshift(...parts);
            splitPerformed = true;
            break;
          }
        }
        if (!splitPerformed) result.push(tok);
      }
      return result;
    };

    const pythonTokens = await tokenizeWithPython(separated);
    if (pythonTokens && pythonTokens.length > 0) {
      const refined = refineTokens(pythonTokens);
      return resolveSynonyms(refined);
    }

    let segmented = separated;
    for (const sw of shortStopwords) segmented = segmented.split(sw).join(' ');
    const rawTokens = segmented.split(/\s+/).filter(Boolean);
    const tokens = [];
    for (const tok of rawTokens) {
      if (stopwords.has(tok)) continue;
      let stripped = tok;
      for (const sw of stopwords) {
        if (sw.length <= 2 && stripped.startsWith(sw) && stripped.length > sw.length) {
          stripped = stripped.slice(sw.length);
          break;
        }
      }
      if (stripped && !stopwords.has(stripped)) tokens.push(stripped);
    }
    const refined = refineTokens(tokens);
    return resolveSynonyms(refined);
  } catch (err) {
    return [String(text || '').trim()];
  }
}

function jaccardSimilarity(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function overlapScore(aTokens, bTokens) {
  const bSet = new Set(bTokens);
  let overlap = 0;
  for (const x of aTokens) if (bSet.has(x)) overlap++;
  return overlap;
}

function semanticOverlapScore(queryTokens, targetTokens) {
  let totalScore = 0;
  for (const qToken of queryTokens) {
    let maxSimilarity = 0;
    for (const tToken of targetTokens) {
      const similarity = getSemanticSimilarity(qToken, tToken);
      if (similarity > maxSimilarity) maxSimilarity = similarity;
    }
    totalScore += maxSimilarity;
  }
  return totalScore;
}

async function rankCandidates(queryTokens, candidates, pool) {
  const results = [];
  for (const item of candidates) {
    const kwTokens = await normalize((item.keywords || []).join(' '), pool);
    const qTextTokens = await normalize(item.QuestionText || '', pool);
    const titleTokens = await normalize(item.QuestionTitle || '', pool);
    // Include Category Name in scoring
    const catTokens = await normalize(item.CategoriesID || '', pool);

    const scoreOverlap = overlapScore(queryTokens, kwTokens) * 2;
    const scoreSemanticKw = semanticOverlapScore(queryTokens, kwTokens) * 2.5;
    const scoreSemanticText = semanticOverlapScore(queryTokens, qTextTokens) * 1.0;
    const scoreSemanticTitle = semanticOverlapScore(queryTokens, titleTokens) * 2.0;
    const scoreCategory = overlapScore(queryTokens, catTokens) * 3.0; // Boost for category match

    const scoreSemantic = jaccardSimilarity(queryTokens, qTextTokens);
    const scoreTitle = jaccardSimilarity(queryTokens, titleTokens) * 2;
    const total = scoreOverlap + scoreSemantic + scoreTitle + scoreSemanticKw + scoreSemanticText + scoreSemanticTitle + scoreCategory;
    
    results.push({ item, score: total, components: { overlap: scoreOverlap, semantic: scoreSemantic, title: scoreTitle, semanticKw: scoreSemanticKw, semanticText: scoreSemanticText, semanticTitle: scoreSemanticTitle, category: scoreCategory } });
  }
  return results.sort((a, b) => b.score - a.score);
}

// --------------------------------------------------------------------------------
// MAIN MODULE
// --------------------------------------------------------------------------------

module.exports = (pool) => async (req, res) => {
  if (req.body?.resetConversation) {
    clearBlockedDomains(req);
    if (!req.body?.message && !req.body?.text && !req.body?.id) return res.status(200).json({ success: true, reset: true });
  }

  // Load basic data
  try { await loadSemanticData(pool); } catch (e) {}
  try { await loadSynonymsMapping(pool); } catch (e) {}
  try { await NEG_KW_MODULE.loadNegativeKeywords(pool); } catch (e) {}
  
  const message = req.body?.message || req.body?.text || '';
  const questionId = req.body?.id;
  let rankingById = new Map();

  // 1. Handle Direct ID Request
  if (questionId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(`SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.QuestionText, qa.ReviewDate, qa.OfficerID, c.CategoriesName AS CategoriesID, c.CategoriesPDF FROM QuestionsAnswers qa LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID WHERE qa.QuestionsAnswersID = ?`, [questionId]);
      if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูล' });
      const item = rows[0];
      return res.status(200).json({ success: true, found: true, answer: item.QuestionText, title: item.QuestionTitle, questionId: item.QuestionsAnswersID, categories: item.CategoriesID || null, categoriesPDF: item.CategoriesPDF || null });
    } catch (err) { return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' }); } finally { if (connection) connection.release(); }
  }

  if (!message || typeof message !== 'string') return res.status(400).json({ success: false, message: 'Invalid payload' });

  let connection;
  try {
    connection = await pool.getConnection();

    // 2. Fetch QA List FIRST
    const qaList = await fetchQAWithKeywords(connection);
    if (!qaList || qaList.length === 0) return res.status(200).json({ success: true, found: false, message: 'ฐานข้อมูลยังไม่พร้อม', results: [] });

    // 3. Normalize Query
    let queryTokens = await normalize(message, pool);
    
    // 3.1 Check Strict No-Match (English Only or Unknown Keywords)
    const isEnglishOnly = /^[a-zA-Z0-9\s.,?!]+$/.test(message);
    const allKeywords = new Set();
    const allCategories = new Set();
    for (const qa of qaList) {
        for (const k of (qa.keywords || [])) {
            allKeywords.add(String(k).toLowerCase().trim());
        }
        if (qa.CategoriesID) allCategories.add(String(qa.CategoriesID).toLowerCase().trim());
    }
    const hasKnownKeyword = queryTokens.some(t => {
        const token = String(t).toLowerCase().trim();
        if (allKeywords.has(token)) return true;
        for (const cat of allCategories) { if (cat.includes(token)) return true; }
        return false;
    });

    if (!hasKnownKeyword || isEnglishOnly) {
        const { getDefaultContacts } = require('../../utils/getDefaultContact_fixed');
        try {
            const contacts = await getDefaultContacts(connection);
            return res.status(200).json({
                success: true,
                found: false,
                message: `😓 ขออภัยจริงๆ ฉันไม่มีข้อมูลเกี่ยวกับคำถามนี้`,
                contacts: contacts
            });
        } catch (e) {
            return res.status(200).json({ success: true, found: false, message: `😓 ขออภัยจริงๆ ฉันไม่มีข้อมูลเกี่ยวกับคำถามนี้`, contacts: [] });
        }
    }

    // --- DEBUG START: วางตรงนี้เพื่อดู log ใน Terminal ---
    const debugNegMap = (NEG_KW_MODULE.getNegativeKeywordsMap && NEG_KW_MODULE.getNegativeKeywordsMap()) || {};
    console.log('--- DEBUG NEGATION ---');
    console.log('User Message:', message);
    console.log('Loaded Negative Words:', Object.keys(debugNegMap).length); 
    // ถ้า Loaded Negative Words เป็น 0 แสดงว่า Module ไม่ส่งค่ามา ต้องใช้การ Query สด
    // --- DEBUG END ---

    // -------------------------------------------------------------
    // 4. Negation Handling (Ultimate Fix)
    // -------------------------------------------------------------
    const blockedDomainsFromSession = loadBlockedDomains(req);
    const blockedKeywordsFromSession = loadBlockedKeywords(req);
    
    // --- DEBUG: เช็คว่า Server เห็นข้อความว่าอะไร ---
    console.log('------------------------------------------------');
    console.log('Incoming Message Raw:', message); 
    // ถ้าตรงนี้ขึ้นว่า "เอาทุน" แสดงว่า "ไม่" ถูกตัดมาจาก Frontend หรือ Middleware อื่น
    console.log('------------------------------------------------');

    // 4.1 ตรวจสอบว่าคำที่ user พิมพ์มา เคยถูกบล็อกไปแล้วหรือยัง
    if (blockedKeywordsFromSession.size > 0) {
      const msgLowerForBlock = message.toLowerCase();
      let matchedBlockedKeyword = null;
      for (const blocked of blockedKeywordsFromSession) {
        if (msgLowerForBlock.includes(blocked)) { 
             matchedBlockedKeyword = blocked; 
             break; 
        }
      }
      if (matchedBlockedKeyword) {
        return res.status(200).json({ 
            success: true, 
            found: false, 
            message: `${BOT_PRONOUN}จำได้ว่าคุณไม่สนใจเรื่อง "${matchedBlockedKeyword}" แล้วค่ะ (พิมพ์ค้นหาเรื่องอื่นได้เลยนะคะ)`, 
            blockedDomains: Array.from(blockedDomainsFromSession), 
            blockedKeywords: Array.from(blockedKeywordsFromSession), 
            blockedKeywordsDisplay: [matchedBlockedKeyword] 
        });
      }
    }

    // 4.2 Dynamic Negative Detection (Robust Fetch)
    let negativeWordsList = [];
    
    // พยายามโหลดจาก Module ก่อน
    const moduleMap = (NEG_KW_MODULE.getNegativeKeywordsMap && NEG_KW_MODULE.getNegativeKeywordsMap()) || {};
    negativeWordsList = Object.keys(moduleMap).map(w => w.trim().toLowerCase()).filter(w => w);

    // ถ้า Module ว่าง ให้ดึงจาก DB โดยตรง (แบบครอบคลุมทุกชื่อ Column)
    if (negativeWordsList.length === 0) {
        try {
            // SELECT * เพื่อกันพลาดเรื่องชื่อ Column
            const [negRows] = await connection.query("SELECT * FROM NegativeKeywords WHERE IsActive = 1"); 
            if (negRows.length > 0) {
                // หา Column ที่น่าจะเป็นคำศัพท์ (Word, InputWord, KeywordText, etc.)
                const firstRow = negRows[0];
                const keyCol = Object.keys(firstRow).find(k => /word|text|keyword/i.test(k)) || Object.keys(firstRow)[1]; // เดาเอาถ้าหาไม่เจอ
                
                negativeWordsList = negRows.map(r => String(r[keyCol] || '').trim().toLowerCase());
                console.log(`Fetched ${negativeWordsList.length} negative words from DB (Column: ${keyCol})`);
            }
        } catch (dbErr) {
            console.error('Error fetching negative keywords:', dbErr.message);
        }
    }

    // *** FALLBACK LIST (กันตาย) *** // ถ้า DB พัง หรือหาไม่เจอ ให้ใช้ลิสต์นี้แน่นอน
    if (negativeWordsList.length === 0) {
        negativeWordsList = ['ไม่', 'ไม่เอา', 'ยกเลิก', 'พอ', 'หยุด', 'ไม่ต้องการ', 'บ่เอา'];
        console.log('Using Hardcoded Fallback Negative List');
    }

    // เรียงคำปฏิเสธจาก "ยาวไปสั้น" (สำคัญมาก: 'ไม่เอา' ต้องมาก่อน 'ไม่')
    negativeWordsList.sort((a, b) => b.length - a.length);

    let hasNegationTrigger = false;
    let targetRejection = ''; 
    const msgLower = message.toLowerCase().trim();

    for (const prefix of negativeWordsList) {
        // เช็คว่าประโยค "ขึ้นต้นด้วย" หรือ "มีคำว่า" คำปฏิเสธหรือไม่
        if (msgLower.startsWith(prefix) || msgLower.indexOf(prefix) === 0) {
            hasNegationTrigger = true;
            
            // ตัดคำปฏิเสธออก: "ไม่เอาทุน" -> ตัด "ไม่เอา" -> เหลือ "ทุน"
            let remainingText = msgLower.substring(prefix.length).trim();
            
            if (remainingText.length > 0) {
                targetRejection = remainingText;
            }
            break; 
        }
    }

    // 4.3 ตัดสินใจ (Decision Logic)
    if (hasNegationTrigger) {
        if (targetRejection.length > 1) {
             persistBlockedKeywords(req, [targetRejection]);
             return res.status(200).json({ 
                success: true, 
                found: false, 
                message: `รับทราบค่ะ ${BOT_PRONOUN}จะไม่แสดงข้อมูลเกี่ยวกับ "${targetRejection}" ให้กวนใจแล้วค่ะ`,
                blockedDomains: Array.from(loadBlockedDomains(req)), 
                blockedKeywords: Array.from(loadBlockedKeywords(req)), 
                blockedKeywordsDisplay: [targetRejection] 
            });
        } else {
             return res.status(200).json({ 
                success: true, 
                found: false, 
                message: `รับทราบค่ะ ${BOT_PRONOUN}ยกเลิกการค้นหาให้แล้วนะคะ`, 
                blockedDomains: Array.from(loadBlockedDomains(req)), 
                blockedKeywords: Array.from(loadBlockedKeywords(req))
            });
        }
    }

    // 5. Ranking
    const ranked = await rankCandidates(queryTokens, qaList, pool);
    ranked.sort((a, b) => b.score - a.score);

    // 6. Filtering (Smart & Strict)
    let finalResults = ranked;
    if (ranked.length > 0) {
        const bestMatch = ranked[0];
        const bestScore = bestMatch.score;

        // 6.1 Relative Threshold (70%)
        if (bestScore > 5.0) { 
             finalResults = finalResults.filter(r => r.score >= (bestScore * 0.7)); 
        }

        // 6.2 Specific Keyword Constraint
        const rawQuery = message.toLowerCase().replace(/\s+/g, '');
        const bestKeywords = (bestMatch.item.keywords || []).map(k => k.toLowerCase().replace(/\s+/g, ''));
        const specificTerm = bestKeywords.find(k => rawQuery.includes(k) && k.length > 4 && !['สมัครเรียน', 'ข้อมูล', 'ติดต่อ'].includes(k));

        if (specificTerm) {
             console.log(`🔒 Enforcing strict filter for term: "${specificTerm}"`);
             finalResults = finalResults.filter(r => {
                 const rKw = (r.item.keywords || []).map(k => k.toLowerCase().replace(/\s+/g, ''));
                 const rTitle = (r.item.QuestionTitle || '').toLowerCase().replace(/\s+/g, '');
                 return rKw.some(k => k.includes(specificTerm)) || rTitle.includes(specificTerm);
             });
        }
    }

    // 7. Final Response (Success or Fallback)
    if (finalResults.length === 0) {
        const { getDefaultContacts } = require('../../utils/getDefaultContact_fixed');
        try {
            const contacts = await getDefaultContacts(connection);
            return res.status(200).json({ success: true, found: false, message: `ไม่พบข้อมูลที่ตรงกัน`, contacts: contacts });
        } catch (e) {
            return res.status(200).json({ success: true, found: false, message: `ไม่พบข้อมูลที่ตรงกัน`, contacts: [] });
        }
    }

    const topRanked = finalResults.slice(0, 3);
    
    // 🆕 8. Contact Fetching Logic (Hide if 1 answer, Show if >1)
    let specificContacts = [];
    if (topRanked.length > 1) { 
        try {
          const qaIds = topRanked.map(r => r.item.QuestionsAnswersID).filter(id => !!id);
          if (qaIds.length > 0) {
            const [rows] = await connection.query(`
              SELECT DISTINCT org.OrgName AS organization, c.CategoriesName AS category, cc.Contact AS contact 
              FROM QuestionsAnswers qa 
              LEFT JOIN Officers o ON qa.OfficerID = o.OfficerID 
              LEFT JOIN Organizations org ON o.OrgID = org.OrgID 
              LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID 
              LEFT JOIN Categories_Contact cc ON (c.CategoriesID = cc.CategoriesID OR c.ParentCategoriesID = cc.CategoriesID) 
              WHERE qa.QuestionsAnswersID IN (?) AND ((cc.Contact IS NOT NULL AND TRIM(cc.Contact) <> '') OR (c.CategoriesID IS NULL)) 
              ORDER BY org.OrgID ASC, c.CategoriesName ASC`, [qaIds]);
            
            specificContacts = (rows || []).map(row => ({ organization: row.organization, category: row.category || null, contact: row.contact || null }));
          }
        } catch (e) { specificContacts = []; }
    }

    const msgText = topRanked.length > 1 
      ? `✨ พบ ${topRanked.length} คำถามที่ใกล้เคียง\n(ลองเลือกซักอันดูสิ 😊)`
      : `✨ นี่คือคำตอบที่คุณหา`;

    return res.status(200).json({
      success: true,
      found: topRanked.length > 0,
      multipleResults: topRanked.length > 1,
      query: message,
      message: msgText,
      contacts: specificContacts,
      alternatives: topRanked.map(r => ({ id: r.item.QuestionsAnswersID, title: r.item.QuestionTitle, preview: (r.item.QuestionText || '').slice(0, 200), text: r.item.QuestionText, score: r.score.toFixed(2), keywords: r.item.keywords, categories: r.item.CategoriesID || null, categoriesPDF: r.item.CategoriesPDF || null }))
    });
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด', detail: err.message });
  } finally {
    if (connection) connection.release();
  }
};