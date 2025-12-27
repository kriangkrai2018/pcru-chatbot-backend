// ✨ Enhanced respond.js with Word Embedding-like scoring
// เพิ่มการให้คะแนนตามความหมายที่ใกล้เคียง (Semantic Similarity)
// 📦 ดึงข้อมูลจาก Database แทน hardcode
// 🛡️ QUALITY GUARD: ป้องกัน chatbot ตอบมั่ว ตอบไม่ตรงคำถาม
// ⛔ NEGATIVE KEYWORDS: ดักจับประโยคปฏิเสธ (Look Backward Algorithm)

const { getStopwordsSet } = require('../stopwords/loadStopwords');
const { 
  getSemanticSimilarity: loadSemanticSimilarity
} = require('../semanticData/loadSemanticData');
const { calculateFinalRanking } = require('../ranking/calculateFinalRanking');
const { 
  loadNegativeKeywords, 
  getNegativeKeywordsMap,
  analyzeQueryNegation, 
  simpleTokenize,
  checkNegation,
  detectBridgeIntent,
  INLINE_NEGATION_PATTERNS
} = require('../negativeKeywords/loadNegativeKeywords');
const BOT_PRONOUN = process.env.BOT_PRONOUN || 'หนู';

// 🧠 Sticky negation store per session (in-memory, short-lived)
const NEGATION_BLOCKS = new Map(); // sessionKey -> { blockedDomains: Set<string>, blockedKeywords: Set<string>, updatedAt: number }
const NEGATION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getSessionKey(req) {
  const explicit = req.headers['x-session-id'] || req.body?.sessionId;
  if (explicit) return String(explicit);
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown-ip';
  const ua = req.headers['user-agent'] || 'unknown-ua';
  return `${ip}::${ua}`;
}

function loadBlockedDomains(req) {
  const key = getSessionKey(req);
  const entry = NEGATION_BLOCKS.get(key);
  if (!entry) return new Set();
  if (Date.now() - entry.updatedAt > NEGATION_TTL_MS) {
    NEGATION_BLOCKS.delete(key);
    return new Set();
  }
  return new Set(entry.blockedDomains || []);
}

// 🆕 Load blocked keywords from session
function loadBlockedKeywords(req) {
  const key = getSessionKey(req);
  const entry = NEGATION_BLOCKS.get(key);
  if (!entry) return new Set();
  if (Date.now() - entry.updatedAt > NEGATION_TTL_MS) {
    NEGATION_BLOCKS.delete(key);
    return new Set();
  }
  return new Set(entry.blockedKeywords || []);
}

function persistBlockedDomains(req, domains) {
  const key = getSessionKey(req);
  const currentDomains = loadBlockedDomains(req);
  const currentKeywords = loadBlockedKeywords(req);
  domains.forEach(d => currentDomains.add(d));
  NEGATION_BLOCKS.set(key, { blockedDomains: currentDomains, blockedKeywords: currentKeywords, updatedAt: Date.now() });
}

// 🆕 Persist blocked keywords to session
function persistBlockedKeywords(req, keywords) {
  const key = getSessionKey(req);
  const currentDomains = loadBlockedDomains(req);
  const currentKeywords = loadBlockedKeywords(req);
  keywords.forEach(k => currentKeywords.add(String(k).toLowerCase()));
  NEGATION_BLOCKS.set(key, { blockedDomains: currentDomains, blockedKeywords: currentKeywords, updatedAt: Date.now() });
}

function clearBlockedDomains(req) {
  const key = getSessionKey(req);
  NEGATION_BLOCKS.delete(key);
}

// Quality guard and verification features removed

// Cache for current request (loaded from DB)
let SEMANTIC_SIMILARITY = {};
let SYNONYMS_MAPPING = {}; // InputWord -> TargetKeyword mapping for query resolution

// 🆕 Track queries for learning (even failed ones)
const recentQueries = new Map(); // query -> { timestamp, matched: boolean }
const RECENT_QUERY_TTL = 60000; // 1 minute

// 🆕 Track successful patterns for learning
const successfulPatterns = new Map(); // pattern -> count

/**
 * Load synonyms mapping from database into memory cache
 * Maps InputWord -> TargetKeyword for query resolution
 * @param {Pool} pool - MySQL connection pool
 */
async function loadSynonymsMapping(pool) {
  try {
    const connection = await pool.getConnection();
    const [synonyms] = await connection.query(`
      SELECT 
        s.InputWord,
        k.KeywordText AS TargetKeyword
      FROM KeywordSynonyms s
      LEFT JOIN Keywords k ON s.TargetKeywordID = k.KeywordID
      WHERE s.IsActive = 1 AND k.KeywordText IS NOT NULL
    `);
    connection.release();
    
    SYNONYMS_MAPPING = {};
    for (const row of synonyms) {
      SYNONYMS_MAPPING[row.InputWord.toLowerCase()] = row.TargetKeyword.toLowerCase();
    }
    
    console.log(`✅ Loaded ${Object.keys(SYNONYMS_MAPPING).length} synonym mappings`);
  } catch (error) {
    console.error('❌ Error loading synonyms:', error.message);
    SYNONYMS_MAPPING = {};
  }
}

/**
 * Load semantic data from database into memory cache
 * @param {Pool} pool - MySQL connection pool
 */
async function loadSemanticData(pool) {
  SEMANTIC_SIMILARITY = await loadSemanticSimilarity(pool);
}

/**
 * Calculate semantic similarity score between two words
 * @param {string} word1 
 * @param {string} word2 
 * @returns {number} similarity score (0-1)
 */
function getSemanticSimilarity(word1, word2) {
  // Exact match
  if (word1 === word2) return 1.0;
  
  // Check synonym dictionary (from database)
  if (SEMANTIC_SIMILARITY[word1] && SEMANTIC_SIMILARITY[word1][word2]) {
    return SEMANTIC_SIMILARITY[word1][word2];
  }
  
  // Substring match (partial)
  if (word1.includes(word2) || word2.includes(word1)) {
    const longer = word1.length > word2.length ? word1 : word2;
    const shorter = word1.length <= word2.length ? word1 : word2;
    return shorter.length / longer.length * 0.7; // Partial match bonus
  }
  
  return 0.0;
}

/**
 * Resolve synonyms in tokens - replace InputWord with TargetKeyword
 * @param {Array<string>} tokens - Array of tokens
 * @returns {Array<string>} tokens with synonyms resolved
 */
function resolveSynonyms(tokens) {
  return tokens.map(token => {
    const lowerToken = token.toLowerCase();
    // If this token is a synonym, replace with target keyword
    if (SYNONYMS_MAPPING[lowerToken]) {
      console.log(`🔄 Synonym resolved: '${token}' -> '${SYNONYMS_MAPPING[lowerToken]}'`);
      return SYNONYMS_MAPPING[lowerToken];
    }
    return token;
  });
}

async function normalize(text, pool) {
  try {
  const t = String(text || '').toLowerCase().trim();
  const cleaned = t.replace(/[\p{P}\p{S}]/gu, ' ');
  // Ensure separation between letters and numbers so tokens like "มี2.00" -> ["มี", "2", "00"]
  const separated = cleaned.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
  const stopwords = await getStopwordsSet(pool);
  // Debugging: log basic info to help trace why 'มี' isn't removed
  try {
    console.log(`🔍 normalize input="${t}" separated="${separated}" stopwordsCount=${stopwords.size} hasมี=${stopwords.has('มี')}`);
  } catch (e) {
    // ignore logging errors
  }
  const shortStopwords = Array.from(stopwords).filter((sw) => sw && sw.length <= 4);
  // Sort stopwords by length descending to match longest possible stopword first (e.g., "อยากรู้" before "รู้")
  const sortedStopwords = Array.from(stopwords).sort((a, b) => b.length - a.length);

  const refineTokens = (tokens) => {
    const result = [];
    const queue = [...tokens]; // Use a queue to process tokens and their sub-parts
    const seen = new Set(); // Avoid infinite loops on weird splits
    let loopCount = 0;

    while (queue.length > 0) {
        if (loopCount++ > 1000) {
            console.warn('⚠️ refineTokens loop limit exceeded');
            break;
        }
        const tok = queue.shift().trim();
        if (!tok || seen.has(tok)) continue;
        seen.add(tok);

        // Check if the token itself is a stopword
        if (stopwords.has(tok)) {
            continue;
        }

        let splitPerformed = false;
        for (const sw of sortedStopwords) {
            if (!sw) continue;
            // Check if the token contains a short stopword but is not the stopword itself
            if (tok.includes(sw) && tok !== sw) {
                const parts = tok.split(sw).map((p) => p.trim()).filter(Boolean);
                if (parts.length > 0) {
                    // Add the new parts to the front of the queue to be processed again
                    queue.unshift(...parts);
                }
                splitPerformed = true;
                break; // Process one split at a time
            }
        }

        // If no split was performed, the token is considered final
        if (!splitPerformed) {
            result.push(tok);
        }
    }
    return result;
  };

  // Prefer PyThaiNLP tokenizer if service is available
  const pythonTokens = await tokenizeWithPython(separated);
  if (pythonTokens && pythonTokens.length > 0) {
    const refined = refineTokens(pythonTokens);
    return resolveSynonyms(refined); // 🆕 Resolve synonyms
  }

  // Heuristic segmentation fallback: split merged Thai text by short stopwords inside the string
  let segmented = separated;
  for (const sw of shortStopwords) {
    segmented = segmented.split(sw).join(' ');
  }

  const rawTokens = segmented.split(/\s+/).filter(Boolean);
  const tokens = [];

  for (const tok of rawTokens) {
    if (stopwords.has(tok)) continue;

    // Basic Thai prefix stripping for merged words (e.g., "หาทุน" -> "ทุน")
    let stripped = tok;
    for (const sw of stopwords) {
      if (sw.length <= 2 && stripped.startsWith(sw) && stripped.length > sw.length) {
        stripped = stripped.slice(sw.length);
        break;
      }
    }

    if (stripped && !stopwords.has(stripped)) {
      tokens.push(stripped);
    }
  }

  const refined = refineTokens(tokens);
  return resolveSynonyms(refined); // 🆕 Resolve synonyms
  } catch (err) {
    console.error('❌ Normalize error:', err);
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

/**
 * 🆕 Enhanced semantic overlap score using Word Embedding-like similarity
 * Similar to the document's "Word Embedding Scoring" approach
 */
function semanticOverlapScore(queryTokens, targetTokens) {
  let totalScore = 0;
  
  for (const qToken of queryTokens) {
    let maxSimilarity = 0;
    
    for (const tToken of targetTokens) {
      const similarity = getSemanticSimilarity(qToken, tToken);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
      }
    }
    
    totalScore += maxSimilarity;
  }
  
  return totalScore;
}

// Configurable similarity threshold for keyword matching (allows merged Thai tokens like "ดูทุน" ~ "ทุน")
const KW_SIM_THRESHOLD = parseFloat(process.env.KW_SIM_THRESHOLD) || 0.5; // was 0.7

// Optional PyThaiNLP tokenizer microservice (FastAPI)
const TOKENIZER_HOST = process.env.TOKENIZER_HOST || 'project.3bbddns.com';
const TOKENIZER_PORT = process.env.TOKENIZER_PORT || '36146';
const TOKENIZER_PATH = process.env.TOKENIZER_PATH || '/tokenize';
const TOKENIZER_URL = process.env.TOKENIZER_URL || `http://${TOKENIZER_HOST}:${TOKENIZER_PORT}${TOKENIZER_PATH}`;

async function tokenizeWithPython(text) {
  if (!TOKENIZER_URL) return null;

  let urlObj;
  try {
    urlObj = new URL(TOKENIZER_URL);
  } catch (err) {
    console.warn('Invalid TOKENIZER_URL:', err?.message || err);
    return null;
  }

  const payload = JSON.stringify({ text });
  const client = urlObj.protocol === 'https:' ? require('https') : require('http');

  return new Promise((resolve) => {
    const req = client.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data || '{}');
            const tokens = Array.isArray(json.tokens) ? json.tokens : [];
            const cleaned = tokens.map((t) => String(t || '').trim()).filter(Boolean);
            resolve(cleaned);
          } catch (errParse) {
            console.error('Tokenizer service parse error:', errParse?.message || errParse);
            resolve(null);
          }
        });
      }
    );

    req.on('error', (errReq) => {
      console.warn('Tokenizer service unreachable:', errReq?.message || errReq);
      resolve(null);
    });

    req.on('timeout', () => {
      console.warn('Tokenizer service timeout');
      req.destroy();
      resolve(null);
    });

    req.write(payload);
    req.end();
  });
}

async function fetchQAWithKeywords(connection) {
  const [rows] = await connection.query(
    `SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.ReviewDate, qa.QuestionText, qa.OfficerID,
            c.CategoriesName AS CategoriesID, c.CategoriesPDF
     FROM QuestionsAnswers qa
     LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID`
  );

  const result = [];
  for (const row of rows) {
    const [keywords] = await connection.query(
      `SELECT k.KeywordText
       FROM Keywords k
       INNER JOIN AnswersKeywords ak ON k.KeywordID = ak.KeywordID
       WHERE ak.QuestionsAnswersID = ?`,
      [row.QuestionsAnswersID]
    );
    result.push({
      ...row,
      keywords: (keywords || []).map(k => k.KeywordText)
    });
  }
  return result;
}

/**
 * 🆕 Enhanced ranking with semantic similarity (like the document)
 */
async function rankCandidates(queryTokens, candidates, pool) {
  const results = [];
  
  for (const item of candidates) {
    const kwTokens = await normalize((item.keywords || []).join(' '), pool);
    const qTextTokens = await normalize(item.QuestionText || '', pool);
    const titleTokens = await normalize(item.QuestionTitle || '', pool);
    
    // Traditional overlap
    const scoreOverlap = overlapScore(queryTokens, kwTokens) * 2;
    
    // 🆕 Semantic overlap (Word Embedding-like)
    const scoreSemanticKw = semanticOverlapScore(queryTokens, kwTokens) * 2.5;
    const scoreSemanticText = semanticOverlapScore(queryTokens, qTextTokens) * 1.0;
    const scoreSemanticTitle = semanticOverlapScore(queryTokens, titleTokens) * 2.0;
    
    // Jaccard similarity
    const scoreSemantic = jaccardSimilarity(queryTokens, qTextTokens);
    const scoreTitle = jaccardSimilarity(queryTokens, titleTokens) * 2;
    
    // Combined score with semantic boost
    const total = scoreOverlap + scoreSemantic + scoreTitle + 
                  scoreSemanticKw + scoreSemanticText + scoreSemanticTitle;
    
    results.push({ 
      item, 
      score: total, 
      components: { 
        overlap: scoreOverlap, 
        semantic: scoreSemantic, 
        title: scoreTitle,
        semanticKw: scoreSemanticKw,
        semanticText: scoreSemanticText,
        semanticTitle: scoreSemanticTitle
      } 
    });
  }
  
  return results.sort((a, b) => b.score - a.score);
}

module.exports = (pool) => async (req, res) => {
  // Allow frontend to clear conversation (e.g., trash button)
  if (req.body?.resetConversation) {
    clearBlockedDomains(req);
    // If this is only a reset call, acknowledge immediately to avoid 400
    if (!req.body?.message && !req.body?.text && !req.body?.id) {
      return res.status(200).json({ success: true, reset: true });
    }
  }

  // Load semantic data, synonyms, and negative keywords from database at start of each request
  await loadSemanticData(pool);
  await loadSynonymsMapping(pool); // 🆕 Load synonym mappings
  await loadNegativeKeywords(pool); // ⛔ Load negative keywords
  
  const message = req.body?.message || req.body?.text || '';
  const questionId = req.body?.id;
  let rankingById = new Map();

  // Direct answer by ID
  if (questionId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(
        `SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.QuestionText, qa.ReviewDate, qa.OfficerID,
                c.CategoriesName AS CategoriesID, c.CategoriesPDF
         FROM QuestionsAnswers qa
         LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
         WHERE qa.QuestionsAnswersID = ?`,
        [questionId]
      );
      
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, message: '😕 ไม่เจออย่างนั้นเหรอ ลองดูเลขที่ใหม่ดึก' });
      }

      const item = rows[0];
      return res.status(200).json({
        success: true,
        found: true,
        answer: item.QuestionText,
        title: item.QuestionTitle,
        questionId: item.QuestionsAnswersID,
        categories: item.CategoriesID || null,
        categoriesPDF: item.CategoriesPDF || null
      });
    } catch (err) {
      console.error('chat/respond (by ID) error:', err && (err.message || err));
      return res.status(500).json({ success: false, message: '😭 อุ๊ะ มีปัญหาเล็กน้อยเกิดขึ้น ลองใหม่ดูนะ' });
    } finally {
      if (connection) connection.release();
    }
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ success: false, message: 'Invalid payload: expected {message: string} or {id: number}' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    let queryTokens = await normalize(message, pool);
    // If normalization removed all tokens (e.g., the query was only stopwords),
    // treat as no-answer and return fallback contact info instead of ranking.
    if (!queryTokens || queryTokens.length === 0) {
      try {
        const { getDefaultContact } = require('../../utils/getDefaultContact');
        const defaultContact = await getDefaultContact(connection);
        const contacts = defaultContact ? (Array.isArray(defaultContact) ? defaultContact : [defaultContact]) : [];
        return res.status(200).json({
          success: true,
          found: false,
          message: `😅 ขออภัยนะ ฉันค่อนข้างงงกับคำถามนี้\n\nถ้าต้องการความช่วยเหลือ ลองติดต่อทีมที่เกี่ยวข้องของมหาวิทยาลัยได้นะ ฉันจะให้ข้อมูลติดต่อให้`,
          contacts
        });
      } catch (e) {
        console.error('Error returning early fallback for empty tokens:', e && e.message);
        return res.status(200).json({ success: true, found: false, message: 'ขออภัย ระบบไม่พบคำตอบที่ตรงกับคำถามนี้', results: [] });
      }
    }
    
    // ⛔ Capture original tokens (before stopword removal) for negation detection
    const originalTokens = simpleTokenize(message);
    const negationAnalysis = analyzeQueryNegation(originalTokens, queryTokens);
    const blockedDomainsFromSession = loadBlockedDomains(req);
    const hadBlockedDomains = blockedDomainsFromSession.size > 0;
    const blockedKeywordsFromSession = loadBlockedKeywords(req);

    // � Log current session blocked state
    if (blockedKeywordsFromSession.size > 0 || blockedDomainsFromSession.size > 0) {
      console.log(`📊 Session state - Blocked keywords: [${Array.from(blockedKeywordsFromSession).join(', ')}], Blocked domains: [${Array.from(blockedDomainsFromSession).join(', ')}]`);
    }

    // �🔒 EARLY CHECK: If user's query exactly matches or contains a blocked keyword, reject early
    // Formula: คำปฏิเสธ - (คำพร้อง+คำสำคัญ) = keyword ถูกปฏิเสธ
    // User ถาม keyword ที่ถูก block → ต้องไม่แสดง
    if (blockedKeywordsFromSession.size > 0) {
      const msgLowerForBlock = message.toLowerCase().trim();
      let matchedBlockedKeyword = null;
      
      // Check if query exactly matches any blocked keyword
      for (const blocked of blockedKeywordsFromSession) {
        // Exact match
        if (msgLowerForBlock === blocked) {
          matchedBlockedKeyword = blocked;
          break;
        }
        // Query contains the blocked keyword (but not with negation prefix)
        // Only block if the query IS the keyword, not just contains it
        // e.g., "ทุนเรียนดี" blocked → "ทุนเรียนดี" query = blocked
        // But "ทุน" query should still show other scholarships
      }
      
      if (matchedBlockedKeyword) {
        console.log(`🚫 Query "${message}" directly asks for blocked keyword "${matchedBlockedKeyword}" - rejecting early`);
        return res.status(200).json({
          success: true,
          found: false,
          message: `${BOT_PRONOUN}ได้ปิดเรื่อง "${matchedBlockedKeyword}" ไว้แล้วค่ะ ถ้าต้องการดูเรื่องนี้อีกครั้ง กดรีเซ็ต (ถังขยะ) แล้วลองใหม่ได้นะคะ 😊`,
          blockedDomains: Array.from(blockedDomainsFromSession),
          blockedKeywords: Array.from(blockedKeywordsFromSession),
          blockedKeywordsDisplay: [matchedBlockedKeyword]
        });
      }
    }

    // Negative keywords must come from DB list only
    const negMap = getNegativeKeywordsMap && getNegativeKeywordsMap();
    const negationWordsSet = new Set();
    if (negMap && typeof negMap === 'object') {
      Object.keys(negMap).forEach(w => {
        const cleaned = String(w || '').trim().toLowerCase();
        if (cleaned) negationWordsSet.add(cleaned);
      });
    }

    // Track whether any valid negation trigger was detected
    let hasNegationTrigger = false;

    // 🆕 Extract negated keywords directly from the message
    // Pattern: ไม่เอา/ไม่ต้อง/ไม่อยาก + keyword
    const negatedKeywordsFromMessage = [];
    const negatedKeywordsDisplayMap = new Map(); // cleaned -> original text for display
    // Build prefixes dynamically from DB negative keywords + inline patterns (longest first)
    const buildNegationPrefixes = () => {
      const set = new Set();
      negationWordsSet.forEach(w => set.add(w));
      if (Array.isArray(INLINE_NEGATION_PATTERNS)) {
        INLINE_NEGATION_PATTERNS.forEach(p => {
          const cleaned = String(p.word || '').trim().toLowerCase();
          if (cleaned && negationWordsSet.has(cleaned)) set.add(cleaned);
        });
      }
      // Sort longest first to match the most specific phrase first
      return Array.from(set).sort((a, b) => b.length - a.length);
    };
    const negationPrefixes = buildNegationPrefixes();
    const msgLower = message.toLowerCase();
    
    // Words that are part of negation phrases and should NOT be treated as keywords
    // Pull from DB (NegativeKeywords) + inline patterns to avoid hardcoding
    const buildNegationPartWords = () => {
      const set = new Set();
      negationWordsSet.forEach(w => set.add(w));
      if (Array.isArray(INLINE_NEGATION_PATTERNS)) {
        INLINE_NEGATION_PATTERNS.forEach(p => {
          const cleaned = String(p.word || '').trim().toLowerCase();
          if (cleaned && negationWordsSet.has(cleaned)) set.add(cleaned);
        });
      }
      return set;
    };
    const negationPartWords = buildNegationPartWords();
    const isNegationPart = (word) => negationPartWords.has(String(word || '').toLowerCase());
    
    // Track which parts of message we've already extracted to avoid duplicates
    let alreadyExtracted = new Set();
    
    const addNegatedKeyword = (cleaned, originalDisplay) => {
      // Skip very short tokens to avoid blocking generic words (e.g., "ทุน", "หอ")
      if (!cleaned || cleaned.length < 3) return;
      if (isNegationPart(cleaned)) return;
      if (alreadyExtracted.has(cleaned)) return;
      const displayText = (originalDisplay && Array.from(negationPartWords).some(p => originalDisplay.startsWith(p)))
        ? cleaned
        : (originalDisplay || cleaned);
      negatedKeywordsFromMessage.push(cleaned);
      negatedKeywordsDisplayMap.set(cleaned, displayText);
      alreadyExtracted.add(cleaned);
    };

    for (const prefix of negationPrefixes) {
      const prefixIdx = msgLower.indexOf(prefix);
      if (prefixIdx !== -1) {
        // Extract what comes after the negation prefix
        hasNegationTrigger = true;
        let afterPrefix = msgLower.slice(prefixIdx + prefix.length).trim();
        
        if (afterPrefix.length > 0) {
          // Take the first meaningful word/phrase (up to space or end)
          let firstWord = afterPrefix.split(/[\s,.:;!?]+/)[0];
          const originalWord = firstWord;
          
          // Remove leading negation part words (e.g., "เอาอยากจีบ" → "อยากจีบ" → "จีบ")
          let cleaned = firstWord;
          for (const partWord of negationPartWords) {
            if (cleaned.startsWith(partWord) && cleaned.length > partWord.length) {
              cleaned = cleaned.slice(partWord.length);
            }
          }
          // Do another pass in case there are nested parts (e.g., "เอาอยาก" → "อยาก" → "")
          for (const partWord of negationPartWords) {
            if (cleaned.startsWith(partWord) && cleaned.length > partWord.length) {
              cleaned = cleaned.slice(partWord.length);
            }
          }
          firstWord = cleaned;
          
          if (firstWord && firstWord.length >= 2 && !alreadyExtracted.has(firstWord) && !isNegationPart(firstWord)) {
            addNegatedKeyword(firstWord, originalWord);
          }
        }
        // Only process the longest (most specific) negation prefix
        break;
      }
    }

    // Collect negated domains from analysis and inline fallback (e.g., "ไม่เอาทุน" in one token)
    const negatedDomains = [];
    if (negationAnalysis.hasNegation) {
      console.log(`⛔ Negation detected in query "${message}":`, negationAnalysis.negatedKeywords.map(n => `${n.negativeWord} → ${n.keyword}`).join(', '));
      for (const n of negationAnalysis.negatedKeywords) {
        const negWord = String(n.negativeWord || '').toLowerCase();
        if (!negationWordsSet.has(negWord)) continue;
        hasNegationTrigger = true;
        let kw = String(n.keyword || '').toLowerCase();
        
        // Smart extraction: if this keyword CONTAINS an already-extracted keyword, use the extracted one
        let bestMatch = null;
        for (const extracted of alreadyExtracted) {
          if (kw.includes(extracted) && extracted.length >= 2) {
            // If multiple matches, prefer the longest
            if (!bestMatch || extracted.length > bestMatch.length) {
              bestMatch = extracted;
            }
          }
        }
        
        if (bestMatch) {
          // Use the already-extracted version
          kw = bestMatch;
        } else {
          // Apply standard prefix stripping
          // Remove negation part words from beginning
          for (const partWord of negationPartWords) {
            if (kw.startsWith(partWord) && kw.length > partWord.length) {
              kw = kw.slice(partWord.length);
            }
          }
          // Second pass
          for (const partWord of negationPartWords) {
            if (kw.startsWith(partWord) && kw.length > partWord.length) {
              kw = kw.slice(partWord.length);
            }
          }
        }
        
        // Add to negated keywords list (avoid duplicates and negation parts)
        // Skip if this cleaned keyword was already added from earlier prefix processing
        if (kw.length >= 2) {
          addNegatedKeyword(kw, n.keyword || kw);
        }
        // Also check for domain blocks
        // Block specific keyword only; do not block entire scholarship domain when user negates a specific scholarship keyword
        if (kw.includes('หอ')) negatedDomains.push('dorm');
        if (kw.includes('รับสมัคร') || kw.includes('สมัคร')) negatedDomains.push('admissions');
      }
    }
    // Fallback inline detection for combined tokens like "ไม่เอาทุน" or "ไม่อยากสมัคร"
    const domainChecks = [
      { term: 'หอ', domain: 'dorm' },
      { term: 'รับสมัคร', domain: 'admissions' },
      { term: 'สมัคร', domain: 'admissions' },
    ];
    for (const check of domainChecks) {
      const neg = checkNegation(originalTokens, check.term);
      const negWord = String(neg.negativeWord || '').toLowerCase();
      if (neg.isNegated && negationWordsSet.has(negWord) && !negatedDomains.includes(check.domain)) {
        negatedDomains.push(check.domain);
        hasNegationTrigger = true;
        console.log(`⛔ Domain "${check.domain}" blocked due to negation: "${neg.negativeWord}" before "${check.term}"`);
      }
    }
    
    // 🆕 If we found negated keywords, persist them and respond
    const uniqueNegatedKeywords = [...new Set(negatedKeywordsFromMessage)].filter(k => k && k.length >= 2);
    // Validate and pick longest-matching DB keywords present in the user message
    let filteredNegatedKeywords = uniqueNegatedKeywords;
    try {
      const [kwRows] = await connection.query('SELECT LOWER(KeywordText) AS kw FROM Keywords');
      const kwList = (kwRows || []).map(r => (r.kw || '').trim()).filter(Boolean);
      const msgLower = String(message || '').toLowerCase();
      // Find DB keywords that appear in the message
      const matched = kwList.filter(kw => kw && msgLower.includes(kw));
      // Keep longest, drop shorter ones that are substrings of kept ones
      matched.sort((a, b) => b.length - a.length);
      const longestOnly = [];
      for (const kw of matched) {
        if (longestOnly.some(k => k.includes(kw))) continue; // skip shorter overlapping
        longestOnly.push(kw);
      }
      filteredNegatedKeywords = longestOnly.length > 0
        ? longestOnly
        : uniqueNegatedKeywords.filter(kw => kwList.includes(kw));
    } catch (e) {
      console.warn('Negated keyword validation failed, using raw list:', e && e.message);
    }

    if (hasNegationTrigger && (filteredNegatedKeywords.length > 0 || negatedDomains.length > 0)) {
      if (filteredNegatedKeywords.length > 0) {
        persistBlockedKeywords(req, filteredNegatedKeywords);
        console.log(`⛔ Blocked keywords: [${filteredNegatedKeywords.join(', ')}]`);
      }
      if (negatedDomains.length > 0) {
        persistBlockedDomains(req, negatedDomains);
      }
      // If we only blocked keywords (no domain intent), ensure scholarship domain is not blocked.
      if (negatedDomains.length === 0 && filteredNegatedKeywords.length > 0) {
        const key = getSessionKey(req);
        const entry = NEGATION_BLOCKS.get(key);
        if (entry) {
          NEGATION_BLOCKS.set(key, {
            ...entry,
            blockedDomains: new Set(),
            updatedAt: Date.now(),
          });
        }
        console.log('🔧 Domain blocks after keyword-only block:', Array.from(loadBlockedDomains(req)));
      }
      
      // Build response message
      const domainThaiNames = {
        scholarship: 'เรื่องทุน',
        dorm: 'เรื่องหอพัก',
        admissions: 'เรื่องการรับสมัคร',
      };
      const blockedItems = [];
      // If a keyword already covers a domain term, skip adding the domain to keep message specific
      const hasScholarshipKw = filteredNegatedKeywords.some(kw => kw.includes('ทุน'));
      const hasDormKw = filteredNegatedKeywords.some(kw => kw.includes('หอ'));
      const hasAdmissionsKw = filteredNegatedKeywords.some(kw => kw.includes('สมัคร') || kw.includes('รับสมัคร'));

      negatedDomains.forEach(d => {
        if (d === 'scholarship' && hasScholarshipKw) return;
        if (d === 'dorm' && hasDormKw) return;
        if (d === 'admissions' && hasAdmissionsKw) return;
        blockedItems.push(domainThaiNames[d] || d);
      });

      // Add keyword-specific blocks
      filteredNegatedKeywords.forEach(kw => {
        const display = negatedKeywordsDisplayMap.get(kw) || kw;
        blockedItems.push(`เรื่อง "${display}"`);
      });
      
      const blockedNames = blockedItems.length > 0 ? blockedItems.join(', ') : 'หัวข้อที่คุณปฏิเสธ';
      
      // Short-circuit response to clearly acknowledge the block action
      return res.status(200).json({
        success: true,
        found: false,
        message: `รับทราบค่ะ ${BOT_PRONOUN}จะไม่แนะนำ${blockedNames}แล้วนะคะ มีอะไรอื่นให้ช่วยไหมคะ? 😊`,
        blockedDomains: Array.from(loadBlockedDomains(req)),
        blockedKeywords: Array.from(loadBlockedKeywords(req)),
        blockedKeywordsDisplay: uniqueNegatedKeywords.map(kw => negatedKeywordsDisplayMap.get(kw) || kw)
      });
    }
    
    // Thai word patterns disabled
    const KNOWN_THAI_WORDS = [];
    
    const smartTokenize = (tokens) => {
      const result = [];
      for (const token of tokens) {
        if (token.length <= 4) {
          result.push(token);
          continue;
        }
        
        // Try to split compound Thai words
        let remaining = token;
        const parts = [];
        let splitOccurred = false;
        
        while (remaining.length > 0) {
          let found = false;
          for (const word of KNOWN_THAI_WORDS) {
            if (remaining.startsWith(word)) {
              parts.push(word);
              remaining = remaining.substring(word.length);
              found = true;
              splitOccurred = true;
              break;
            }
          }
          if (!found) {
            // No known word at start, try to find one inside
            let foundInside = false;
            for (const word of KNOWN_THAI_WORDS) {
              const idx = remaining.indexOf(word);
              if (idx > 0 && idx < remaining.length) {
                // Found word inside, split at that position
                const before = remaining.substring(0, idx);
                if (before.length >= 2) parts.push(before);
                parts.push(word);
                remaining = remaining.substring(idx + word.length);
                foundInside = true;
                splitOccurred = true;
                break;
              }
            }
            if (!foundInside) {
              // No split possible, keep remaining as is
              if (remaining.length >= 2) parts.push(remaining);
              break;
            }
          }
        }
        
        if (splitOccurred && parts.length > 0) {
          result.push(...parts);
        } else {
          result.push(token);
        }
      }
      return result.filter(t => t && t.length >= 2);
    };
    
    const tokensBefore = [...queryTokens];
    queryTokens = smartTokenize(queryTokens);
    if (JSON.stringify(tokensBefore) !== JSON.stringify(queryTokens)) {
      console.log(`🔧 Smart tokenizer: [${tokensBefore.join(', ')}] → [${queryTokens.join(', ')}]`);
    }

    const qaList = await fetchQAWithKeywords(connection);
    if (!qaList || qaList.length === 0) {
      return res.status(200).json({
        success: true,
        found: false,
        message: '😊 ดูเหมือนว่าฐานข้อมูลของเรายังไม่พร้อมเลย หรือลองไปดูเวลาอื่นนะ',
        results: []
      });
    }

    const ranked = await rankCandidates(queryTokens, qaList, pool);
    const best = ranked[0];

    const norm = (s) => String(s || '').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').trim();
    const isTitleExact = best && norm(best.item.QuestionTitle) === norm(message);
    const hasAnyOverlap = best && best.components && (best.components.overlap > 0 || best.components.title > 0 || best.components.semantic > 0);

    // Lightweight reranker blends available component scores for better ordering
    const rerankTopCandidates = (matchesWithScore, topN = 20) => {
      const items = matchesWithScore.slice(0, topN).map(m => {
        const c = m.components || { overlap: 0, title: 0, semantic: 0 };
        // Blend weights: title (strong), semantic (medium), overlap (support)
        const blended = (0.5 * (c.title || 0)) + (0.35 * (c.semantic || 0)) + (0.15 * (c.overlap || 0));
        return { ...m, blendedScore: blended };
      });
      return items.sort((a, b) => (b.blendedScore || 0) - (a.blendedScore || 0));
    };

    // Simple BM25 implementation for Thai tokens over title+text+keywords
    const bm25Score = (queryTokens, item, avgDocLen, k1 = 1.5, b = 0.75, idfMap) => {
      const text = `${item.QuestionTitle || ''} ${item.QuestionText || ''} ${(item.keywords || []).join(' ')}`.toLowerCase();
      const docTokens = text.split(/\s+/).filter(Boolean);
      const docLen = docTokens.length || 1;
      const tf = {};
      for (const t of docTokens) tf[t] = (tf[t] || 0) + 1;
      let score = 0;
      for (const q of queryTokens) {
        const f = tf[q] || 0;
        if (f === 0) continue;
        const idf = idfMap[q] || 1.0; // fallback idf
        const denom = f + k1 * (1 - b + b * (docLen / (avgDocLen || docLen)));
        score += idf * ((f * (k1 + 1)) / denom);
      }
      return score;
    };

    // Prepare IDF map using QA corpus once
    const buildIdf = (qaList) => {
      const df = {};
      const N = qaList.length || 1;
      for (const it of qaList) {
        const text = `${it.QuestionTitle || ''} ${it.QuestionText || ''} ${(it.keywords || []).join(' ')}`.toLowerCase();
        const unique = new Set(text.split(/\s+/).filter(Boolean));
        unique.forEach(t => { df[t] = (df[t] || 0) + 1; });
      }
      const idf = {};
      Object.keys(df).forEach(t => {
        // BM25 idf variant
        idf[t] = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      });
      return idf;
    };

    // Answer formatter: summary + key points + sources (friendly)
    const formatAnswer = (rawText, category, pdf) => {
      const text = String(rawText || '').trim();
      const firstSentence = text.split(/(?<=\.|\!|\?)\s+/)[0] || text.slice(0, 120);
      const summary = `💡 สรุปสั้นๆ: ${firstSentence}`;
      // Extract simple bullet points by splitting lines
      const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
      const points = lines
        .filter(l => l.length > 0)
        .slice(0, 5)
        .map(l => (l.length > 160 ? (l.slice(0, 157) + '...') : l));
      const sources = [];
      if (category) sources.push(`หมวดหมู่: ${category}`);
      if (pdf) sources.push(`เอกสาร: ${pdf}`);
      return {
        summary,
        points,
        sources,
        text: text
      };
    };

    // Keyword matching with semantic awareness
    let keywordMatches = [];
    let keywordMatchesWithScore = [];
    
    // 🆕 STRICT NUMERIC KEYWORD MATCH CHECK
    // If the user's message contains a numeric value (e.g., "2.00"), prefer items whose keywords include that numeric token.
    const numericParts = (message || '').match(/\d+(?:\.\d+)*/g);
    if (numericParts && numericParts.length > 0) {
      const numericToken = numericParts[0];
      const numericMatchesItems = qaList.filter(item =>
        (item.keywords || []).some(k => String(k || '').replace(/\s+/g, '').includes(numericToken))
      );
      if (numericMatchesItems.length === 1) {
        const it = numericMatchesItems[0];
        const formatted = formatAnswer(it.QuestionText, it.CategoriesID || null, it.CategoriesPDF || null);
        return res.status(200).json({
          success: true,
          found: true,
          multipleResults: false,
          query: message,
          message: '🎯 พบคำตอบที่ตรงกับตัวเลขที่ระบุ',
          alternatives: [{
            id: it.QuestionsAnswersID,
            title: it.QuestionTitle,
            preview: (it.QuestionText || '').slice(0, 200),
            text: formatted.text,
            summary: formatted.summary,
            points: formatted.points,
            sources: formatted.sources,
            keywords: it.keywords,
            categories: it.CategoriesID || null,
            categoriesPDF: it.CategoriesPDF || null
          }]
        });
      }
      if (numericMatchesItems.length > 1) {
        // If multiple items match the numeric token, restrict subsequent matching to them.
        console.log(`🔢 Numeric token match found for "${numericToken}", restricting to ${numericMatchesItems.length} items.`);
        qaList = numericMatchesItems;
      }
    }

    // 🆕 STRICT EXACT KEYWORD MATCH CHECK
    // Normalize by removing all whitespace to handle "A B" vs "AB"
    const normalizeForExact = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const msgExact = normalizeForExact(message);

    const exactKeywordMatches = qaList.filter(item => 
      (item.keywords || []).some(k => normalizeForExact(k) === msgExact)
    );

    if (exactKeywordMatches.length > 0) {
      console.log(`🎯 Exact keyword match found for "${message}" - restricting to ${exactKeywordMatches.length} items.`);
      keywordMatchesWithScore = exactKeywordMatches.map(item => ({
        item,
        maxSimilarity: 1.0,
        matchCount: 999,
        allTokensMatched: true,
        titleMatchCount: 999,
        keywordInTitleCount: 999,
        exactKeywordInTitleCount: 999,
        components: { overlap: 1, title: 1, semantic: 1 }
      }));
    }

    // 🆕 FALLBACK: If all tokens are stopwords (queryTokens is empty) AND no exact match, try raw text match
    if (keywordMatchesWithScore.length === 0 && queryTokens.length === 0) {
      console.log(`⚠️  Query consists only of stopwords. Trying raw/exact match fallback for: "${message}"`);
      
      const rawQuery = message.toLowerCase().trim();
      
      // Try exact match on title first
      const exactTitleMatch = qaList.find(item => 
        item.QuestionTitle && item.QuestionTitle.toLowerCase().trim() === rawQuery
      );
      
      if (exactTitleMatch) {
        console.log(`🎯 Exact title match found (stopword query): QA#${exactTitleMatch.QuestionsAnswersID}`);
        const formatted = formatAnswer(exactTitleMatch.QuestionText, exactTitleMatch.CategoriesID || null, exactTitleMatch.CategoriesPDF || null);
        return res.status(200).json({
          success: true,
          found: true,
          multipleResults: false,
          query: message,
          message: '🎉 พบคำตอบที่ตรงกับคำค้นของคุณ',
          alternatives: [{
            id: exactTitleMatch.QuestionsAnswersID,
            title: exactTitleMatch.QuestionTitle,
            preview: (exactTitleMatch.QuestionText || '').slice(0, 200),
            text: formatted.text,
            summary: formatted.summary,
            points: formatted.points,
            sources: formatted.sources,
            keywords: exactTitleMatch.keywords,
            categories: exactTitleMatch.CategoriesID || null,
            categoriesPDF: exactTitleMatch.CategoriesPDF || null
          }]
        });
      }
      
      // Try partial match (contains)
      const partialMatches = qaList.filter(item => {
        const titleLower = (item.QuestionTitle || '').toLowerCase();
        const textLower = (item.QuestionText || '').toLowerCase();
        const keywordsLower = (item.keywords || []).map(k => k.toLowerCase());
        
        return titleLower.includes(rawQuery) || 
               textLower.includes(rawQuery) ||
               keywordsLower.some(k => k === rawQuery || k.includes(rawQuery));
      });
      
      if (partialMatches.length > 0) {
        console.log(`📌 Found ${partialMatches.length} partial matches for stopword query`);
        
        // Sort by relevance (title match > keyword match > text match)
        partialMatches.sort((a, b) => {
          const aTitle = (a.QuestionTitle || '').toLowerCase();
          const bTitle = (b.QuestionTitle || '').toLowerCase();
          const aTitleMatch = aTitle.includes(rawQuery) ? 1 : 0;
          const bTitleMatch = bTitle.includes(rawQuery) ? 1 : 0;
          return bTitleMatch - aTitleMatch;
        });
        
        const formatted = partialMatches.slice(0, 5).map(item => ({
          id: item.QuestionsAnswersID,
          title: item.QuestionTitle,
          preview: (item.QuestionText || '').slice(0, 200),
          keywords: item.keywords,
          categories: item.CategoriesID || null
        }));
        
        return res.status(200).json({
          success: true,
          found: true,
          multipleResults: true,
          query: message,
          message: `พบ ${formatted.length} ผลลัพธ์ที่เกี่ยวข้อง`,
          alternatives: formatted
        });
      }
      
      // No matches at all
      console.log(`❌ No matches found for stopword-only query: "${message}"`);
      return res.status(200).json({
        success: true,
        found: false,
        query: message,
        message: 'ไม่พบคำตอบที่ตรงกับคำค้นของคุณ กรุณาลองใช้คำค้นที่ชัดเจนกว่านี้'
      });
    }
    
    if (keywordMatchesWithScore.length > 0 || queryTokens.length > 0) {
      if (keywordMatchesWithScore.length === 0) {
        console.log(`🔍 Query tokens (after stopword removal): [${queryTokens.join(', ')}]`);
        console.log(`📊 Total QA items in database: ${qaList.length}`);
        
        // Semantic-aware keyword matching with scoring
        // ⚡ Optimized: Use synchronous map and simpleTokenize to avoid HTTP storm from normalize()
        keywordMatchesWithScore = qaList.map(item => {
          let maxSimilarity = 0;
          let matchCount = 0;
          let allTokensMatched = true;
          let keywordInTitleCount = 0; // 🆕 Count matching keywords in title
          let exactKeywordInTitleCount = 0; // 🆕 Count exact keyword matches in title tokens
          
          // Tokenize title once for efficient reuse (synchronous)
          const titleTokens = simpleTokenize(item.QuestionTitle || '');
          
          queryTokens.forEach(qToken => {
            let foundMatch = false;
            (item.keywords || []).forEach(kw => {
              const kwLower = kw.toLowerCase();
              const similarity = getSemanticSimilarity(qToken, kwLower);
              if (similarity >= KW_SIM_THRESHOLD) {
                foundMatch = true;
                maxSimilarity = Math.max(maxSimilarity, similarity);
                matchCount++;
                // 🆕 Boost score if this keyword appears in title
                const titleLower = String(item.QuestionTitle || '').toLowerCase();
                if (titleLower.includes(kwLower)) {
                  keywordInTitleCount++;
                  // 🆕 EXTRA BOOST: if keyword appears as exact token in normalized title
                  // e.g., "เอกสาร" as a word in "ต้องใช้เอกสารอะไร"
                  if (titleTokens.includes(kwLower)) {
                    exactKeywordInTitleCount++;
                  }
                }
              }
            });
            if (!foundMatch) allTokensMatched = false;
          });
          
          // 🆕 Also calculate title match score for better ranking
          const titleMatchCount = queryTokens.filter(qToken => 
            titleTokens.some(tToken => {
              const sim = getSemanticSimilarity(qToken, tToken);
              return sim >= KW_SIM_THRESHOLD;
            })
          ).length;
          
          return { item, maxSimilarity, matchCount, allTokensMatched, titleMatchCount, keywordInTitleCount, exactKeywordInTitleCount };
        }).filter(m => m.matchCount > 0);
        
        console.log(`✅ Semantic keyword match: Found ${keywordMatchesWithScore.length} items`);
      }
      
      if (keywordMatchesWithScore.length > 0) {
        // Sort by match quality - prioritize title matches
        keywordMatchesWithScore.sort((a, b) => {
          // First, prioritize items where ALL query tokens are matched
          if (b.allTokensMatched !== a.allTokensMatched) return b.allTokensMatched ? 1 : -1;
          // 🆕 Prioritize by total title match count (queries with more tokens in title are more specific)
          if (b.titleMatchCount !== a.titleMatchCount) return b.titleMatchCount - a.titleMatchCount;
          // Then by exact keyword tokens in title
          if (b.exactKeywordInTitleCount !== a.exactKeywordInTitleCount) return b.exactKeywordInTitleCount - a.exactKeywordInTitleCount;
          // Then, prioritize by keywords appearing in title text
          if (b.keywordInTitleCount !== a.keywordInTitleCount) return b.keywordInTitleCount - a.keywordInTitleCount;
          // Then by keyword match count
          if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
          // Finally by similarity score
          return b.maxSimilarity - a.maxSimilarity;
        });

        // NEW: If the user's normalized query contains 2 or more tokens, prefer results that match ALL tokens.
        // If exactly one item fully matches all tokens, return it immediately as the single best answer.
        try {
          const queryTokenCount = (Array.isArray(queryTokens) ? queryTokens.length : 0);
          if (queryTokenCount >= 2) {
            const allMatched = keywordMatchesWithScore.filter(m => m.allTokensMatched);
            if (allMatched.length === 1) {
              const chosen = allMatched[0].item;
              console.log(`🎯 Exact multi-token match: returning single QA#${chosen.QuestionsAnswersID}`);
              const formatted = formatAnswer(chosen.QuestionText, chosen.CategoriesID || null, chosen.CategoriesPDF || null);
              return res.status(200).json({
                success: true,
                found: true,
                message: `🎯 พบคำตอบที่ตรงกับคำค้นทั้งหมด`,
                totalResults: 1,
                returnedResults: 1,
                alternatives: [{
                  id: chosen.QuestionsAnswersID,
                  title: chosen.QuestionTitle,
                  preview: (chosen.QuestionText || '').slice(0, 200),
                  text: formatted.text,
                  summary: formatted.summary,
                  points: formatted.points,
                  sources: formatted.sources,
                  keywords: chosen.keywords,
                  categories: chosen.CategoriesID || null,
                  categoriesPDF: chosen.CategoriesPDF || null,
                  finalRanking: rankingById.get(chosen.QuestionsAnswersID) || null
                }]
              });
            } else if (allMatched.length > 1) {
              // If multiple fully-matching items exist, restrict further processing to them
              keywordMatchesWithScore = allMatched;
            }
          }
        } catch (err) {
          console.warn('Error while enforcing multi-token exact-match filter:', err && err.message);
        }

        // NEW: Strict multi-keyword-only matching: when the normalized query has 2 or more tokens,
        // require that an item's keywords match EXACTLY the set of query tokens (no extra keywords).
        try {
          if (Array.isArray(queryTokens) && queryTokens.length >= 2) {
            // Build normalized unique set for the query tokens
            const reqNormArr = Array.from(new Set(queryTokens.map(t => normalizeForExact(t)).filter(Boolean)));
            const reqSet = new Set(reqNormArr);

            const strictMatches = keywordMatchesWithScore.filter(m => {
              const kwArr = Array.from(new Set((m.item.keywords || []).map(k => normalizeForExact(k)).filter(Boolean)));
              const kwSet = new Set(kwArr);

              if (kwSet.size !== reqSet.size) return false;
              for (const r of reqSet) if (!kwSet.has(r)) return false;
              return true; // sets are equal
            });

            if (strictMatches.length > 0) {
              // Keep strictMatches (items whose keywords contain all query tokens) for subsequent ranking/limiting
              console.log(`🔎 Found ${strictMatches.length} items containing all query tokens; restricting to them.`);
              keywordMatchesWithScore = strictMatches;
            } else {
              // No strict superset matches; try fallback using raw whitespace-split tokens (helps when stopwords removed tokens)
              const rawTokens = (String(message || '').toLowerCase().split(/\s+/).map(t => normalizeForExact(t)).filter(Boolean));
              const rawSetArr = Array.from(new Set(rawTokens));
              const rawSet = new Set(rawSetArr);

              if (rawSet.size > 0) {
                const fallbackMatches = keywordMatchesWithScore.filter(m => {
                  const kwArr = Array.from(new Set((m.item.keywords || []).map(k => normalizeForExact(k)).filter(Boolean)));
                  const kwSet = new Set(kwArr);
                  // accept superset with at least the same size as rawSet
                  if (kwSet.size < rawSet.size) return false;
                  for (const r of rawSet) if (!kwSet.has(r)) return false;
                  return true;
                });
                if (fallbackMatches.length > 0) {
                  console.log(`🔁 Fallback: found ${fallbackMatches.length} matches using raw tokens: [${rawSetArr.join(', ')}]`);
                  keywordMatchesWithScore = fallbackMatches;
                }
              }
              // If still nothing, we do NOT return early; allow normal ranking to proceed (may show broader matches)
            }
          }
        } catch (err) {
          console.warn('Error while enforcing strict multi-keyword filter:', err && err.message);
        }

        const bestMatch = keywordMatchesWithScore[0];
        
        // Check if exact title match OR all tokens matched with single result
        const exactMatchAllTokens = bestMatch.allTokensMatched && (keywordMatchesWithScore.length === 1 || 
          (keywordMatchesWithScore.length > 1 && keywordMatchesWithScore[0].matchCount > keywordMatchesWithScore[1].matchCount));
        const exactTitleMatch = norm(bestMatch.item.QuestionTitle) === norm(message);
        
        // 🆕 Check if best result is significantly better than others (dominant match)
        let isDominantMatch = false;
        if (keywordMatchesWithScore.length > 1) {
          const bestScore = (bestMatch.maxSimilarity * bestMatch.matchCount) + (bestMatch.titleMatchCount * 2);
          const secondScore = (keywordMatchesWithScore[1].maxSimilarity * keywordMatchesWithScore[1].matchCount) + (keywordMatchesWithScore[1].titleMatchCount * 2);
          // If best result is at least 1.5x better than second place, it's dominant
          isDominantMatch = bestScore > 0 && secondScore > 0 && (bestScore / secondScore) >= 1.3;
        } else {
          isDominantMatch = true;
        }
        
        // 🆕 Filter out blocked results instead of blocking all
        // Formula: คำปฏิเสธ - (คำพร้อง+คำสำคัญ) = items with those keywords blocked
        const isItemBlocked = (matchItem) => {
          if (blockedKeywordsFromSession.size === 0) return false;
          const itemKeywords = (matchItem.keywords || []).map(k => String(k || '').toLowerCase());
          const titleLower = String(matchItem.QuestionTitle || '').toLowerCase();
          const textLower = String(matchItem.QuestionText || '').toLowerCase();
          
          for (const blocked of blockedKeywordsFromSession) {
            // 1️⃣ Check if keyword array contains EXACT match
            if (itemKeywords.some(kw => kw === blocked)) {
              console.log(`🚫 Item blocked: keyword "${blocked}" matches exactly in keywords [${itemKeywords.join(', ')}]`);
              return true;
            }
            
            // 2️⃣ Check if title contains the blocked keyword
            if (titleLower.includes(blocked)) {
              console.log(`🚫 Item blocked: "${blocked}" found in title "${titleLower.substring(0, 50)}..."`);
              return true;
            }
            
            // 3️⃣ Check if text contains the blocked keyword  
            if (textLower.includes(blocked)) {
              console.log(`🚫 Item blocked: "${blocked}" found in text`);
              return true;
            }
            
            // 4️⃣ Also check synonyms
            for (const [synonym, target] of Object.entries(SYNONYMS_MAPPING)) {
              if (target === blocked) {
                if (itemKeywords.some(kw => kw === synonym)) {
                  console.log(`🚫 Item blocked: synonym "${synonym}" of blocked "${blocked}" found in keywords`);
                  return true;
                }
                if (titleLower.includes(synonym)) {
                  console.log(`🚫 Item blocked: synonym "${synonym}" of blocked "${blocked}" found in title`);
                  return true;
                }
              }
            }
          }
          return false;
        };
        
        // Filter out blocked matches
        const unblockedMatches = keywordMatchesWithScore.filter(m => !isItemBlocked(m.item));
        
        if (unblockedMatches.length === 0 && keywordMatchesWithScore.length > 0) {
          // All results were blocked
          console.log(`🚫 All ${keywordMatchesWithScore.length} matches blocked by session keywords: [${Array.from(blockedKeywordsFromSession).join(', ')}]`);
          return res.status(200).json({
            success: true,
            found: false,
            message: `ตอนนี้ปิดหัวข้อที่คุณปฏิเสธไว้ค่ะ ถ้าต้องการดูหัวข้อเดิมอีกครั้ง ให้กดรีเซ็ต (ถังขยะ) แล้วลองใหม่ได้นะคะ`,
            blockedKeywords: Array.from(blockedKeywordsFromSession),
            results: []
          });
        }
        
        // Log if some results were filtered out
        if (unblockedMatches.length < keywordMatchesWithScore.length) {
          console.log(`🔽 Filtered out ${keywordMatchesWithScore.length - unblockedMatches.length} blocked results, ${unblockedMatches.length} remaining`);
        }
        
        // Use unblocked matches for further processing
        const filteredBestMatch = unblockedMatches[0];
        
        // Check exact match using filtered results
        const exactMatchAllTokensFiltered = filteredBestMatch && filteredBestMatch.allTokensMatched && (unblockedMatches.length === 1 || 
          (unblockedMatches.length > 1 && unblockedMatches[0].matchCount > unblockedMatches[1].matchCount));
        const exactTitleMatchFiltered = filteredBestMatch && norm(filteredBestMatch.item.QuestionTitle) === norm(message);
        
        if ((exactMatchAllTokensFiltered && unblockedMatches.length === 1) || exactTitleMatchFiltered) {
          // Return only 1 best answer ONLY if:
          // 1. Exact title match (user typed the exact question)
          // 2. OR all tokens matched with single unique result
          console.log(`🎯 Exact match found: QA#${filteredBestMatch.item.QuestionsAnswersID}`);
          
          // Exact title match: single best answer with formatted content
          const formatted = formatAnswer(filteredBestMatch.item.QuestionText, filteredBestMatch.item.CategoriesID || null, filteredBestMatch.item.CategoriesPDF || null);
          return res.status(200).json({
            success: true,
            found: true,
            multipleResults: false,
            query: message,
            message: '🎉 ตรงเป๊ะ! นี่คือคำตอบที่คุณหา',
            alternatives: [{
              id: filteredBestMatch.item.QuestionsAnswersID,
              title: filteredBestMatch.item.QuestionTitle,
              preview: (filteredBestMatch.item.QuestionText || '').slice(0, 200),
              text: formatted.text,
              summary: formatted.summary,
              points: formatted.points,
              sources: formatted.sources,
              keywords: filteredBestMatch.item.keywords,
              categories: filteredBestMatch.item.CategoriesID || null,
              categoriesPDF: filteredBestMatch.item.CategoriesPDF || null
            }]
          });
        } else {
          // 🆕 Return ALL relevant matches for generic/broad queries, hybrid rerank (BM25 + components)
          const idfMap = buildIdf(qaList);
          const avgDocLen = qaList.reduce((acc, it) => {
            const text = `${it.QuestionTitle || ''} ${it.QuestionText || ''} ${(it.keywords || []).join(' ')}`.toLowerCase();
            return acc + (text.split(/\s+/).filter(Boolean).length);
          }, 0) / (qaList.length || 1);

          // Intent detection removed
          const msgLower = String(message || '').toLowerCase();
          const isCountIntent = false;
          const isListIntent = false;
          const docHints = [];
          const dormTerms = ['หอ', 'หอพัก', 'หอใน', 'หอนอก', 'ที่พัก', 'พักอาศัย'];
          const scholarshipTerms = ['ทุน', 'ทุนการศึกษา', 'ทุนเรียน', 'ทุนเรียนดี', 'ทุนช่วยเหลือ', 'ทุนความสามารถ'];
          const admissionsTerms = ['รับสมัคร', 'สมัครเรียน', 'เข้าศึกษา', 'เข้าเรียน'];
          
          // 🔗 Bridge Intent Detection: user negates one domain but wants another
          const domainTermsMap = { scholarship: scholarshipTerms, dorm: dormTerms, admissions: admissionsTerms };
          const bridgeIntent = detectBridgeIntent(originalTokens, domainTermsMap);
          if (bridgeIntent.hasBridgeIntent) {
            console.log(`🔗 Bridge intent detected: negated=[${bridgeIntent.negatedDomains.join(', ')}], wanted=[${bridgeIntent.wantedDomains.join(', ')}]`);
          }
          
          // 🆕 For list-intent (has "กี่", "อะไรบ้าง", etc.), check for domain-matched count answer first
          // 🔴 Wrapped in try-catch for explicit error handling - fallback to generic ranking on error
          let listIntentHandled = false;
          try {
            if (isListIntent) {
              console.log(`🔍 List-intent logic started: scholarshipTerms=${scholarshipTerms.length}, dormTerms=${dormTerms.length}, admissionsTerms=${admissionsTerms.length}`);
            const queryHasDocIntent = Array.isArray(docHints) && docHints.some(h => msgLower.includes(String(h).toLowerCase()));
            // If query clearly asks about documents, prefer a doc-related QA directly
            if (queryHasDocIntent) {
              const docPreferred = (unblockedMatches || []).find(m => {
                const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
                const textLower = String(m.item.QuestionText || '').toLowerCase();
                return Array.isArray(docHints) && docHints.some(h => titleLower.includes(String(h).toLowerCase()) || textLower.includes(String(h).toLowerCase()));
              });
              if (docPreferred) {
                console.log(`🎯 List-intent (doc) direct answer: QA#${docPreferred.item.QuestionsAnswersID}`);
                const formatted = formatAnswer(docPreferred.item.QuestionText, docPreferred.item.CategoriesID || null, docPreferred.item.CategoriesPDF || null);
                return res.status(200).json({
                  success: true,
                  found: true,
                  multipleResults: false,
                  query: message,
                  message: '✨ นี่คือคำตอบที่คุณหา',
                  alternatives: [{
                    id: docPreferred.item.QuestionsAnswersID,
                    title: docPreferred.item.QuestionTitle,
                    preview: (docPreferred.item.QuestionText || '').slice(0, 200),
                    text: formatted.text,
                    summary: formatted.summary,
                    points: formatted.points,
                    sources: formatted.sources,
                    keywords: docPreferred.item.keywords,
                    categories: docPreferred.item.CategoriesID || null,
                    categoriesPDF: docPreferred.item.CategoriesPDF || null
                  }]
                });
              }
            }
            
            // Only prefer "มีกี่" answer when query does NOT show doc intent
            // 🆕 Smart match: find count-answer that actually matches the domain in the query
            // First try: find count-pattern item that matches query domain directly
            let countPreferred = !queryHasDocIntent && (unblockedMatches || []).find(m => {
              const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
              const catLower = String(m.item.CategoriesID || '').toLowerCase();
              // Check if title has "กี่" pattern AND category/title contains query keywords
              const hasCountPattern = /กี่/.test(titleLower);
              
              // 🆕 IMPROVED: Check if ANY query token matches in title or category
              // Also check if original message contains words from title
              const msgWords = String(message || '').toLowerCase().split(/\s+/).filter(w => w.length >= 2);
              const titleWords = titleLower.split(/[^ก-๙a-z0-9]+/).filter(w => w.length >= 2);
              
              // Match if any query token appears in title
              const tokenMatch = queryTokens && queryTokens.some(token => {
                const tokenLower = String(token).toLowerCase();
                return tokenLower.length >= 2 && (titleLower.includes(tokenLower) || catLower.includes(tokenLower));
              });
              
              // Match if any word from message appears in title (for compound words like "ทุนเรียนดี")
              const wordMatch = msgWords.some(word => word.length >= 3 && titleLower.includes(word));
              
              // Match if title words appear in message
              const reversematch = titleWords.some(word => word.length >= 3 && msgLower.includes(word) && !countHints.includes(word));
              
              const matchesDomain = tokenMatch || wordMatch || reversematch;
              
              if (hasCountPattern && matchesDomain) {
                console.log(`🎯 countPreferred match: "${titleLower}" (tokenMatch=${tokenMatch}, wordMatch=${wordMatch}, reverseMatch=${reversematch})`);
              }
              
              return hasCountPattern && matchesDomain;
            });
            
            // If direct match not found but query is count-intent, try scholarship domain
            if (!countPreferred && isCountIntent && Array.isArray(scholarshipTerms) && scholarshipTerms.length > 0 && msgLower.includes('ทุนช่วยเหลือ')) {
              const scholarshipCountMatches = (unblockedMatches || []).filter(m => {
                const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
                const hasCountPattern = /กี่|ทั้งหมด|อย่าง/.test(titleLower);
                const hasScholarship = scholarshipTerms.some(t => titleLower.includes(String(t).toLowerCase()));
                return hasCountPattern && hasScholarship;
              });
              if (scholarshipCountMatches.length > 0) {
                countPreferred = scholarshipCountMatches[0];
                console.log(`🔄 Using scholarship domain count match: QA#${countPreferred.item.QuestionsAnswersID}`);
              }
            }
            
            // 🆕 Only return direct answer if countPreferred found AND it's domain-matched
            // If not found, skip list-intent logic and use generic ranking
            if (countPreferred) {
              console.log(`🎯 List-intent direct answer (count-preferred): QA#${countPreferred.item.QuestionsAnswersID}`);
              const formatted = formatAnswer(countPreferred.item.QuestionText, countPreferred.item.CategoriesID || null, countPreferred.item.CategoriesPDF || null);
              return res.status(200).json({
                success: true,
                found: true,
                multipleResults: false,
                query: message,
                message: '✨ นี่คือคำตอบที่คุณหา',
                alternatives: [{
                  id: countPreferred.item.QuestionsAnswersID,
                  title: countPreferred.item.QuestionTitle,
                  preview: (countPreferred.item.QuestionText || '').slice(0, 200),
                  text: formatted.text,
                  summary: formatted.summary,
                  points: formatted.points,
                  sources: formatted.sources,
                  keywords: countPreferred.item.keywords,
                  categories: countPreferred.item.CategoriesID || null,
                  categoriesPDF: countPreferred.item.CategoriesPDF || null
                }]
              });
            }
            
            // 🆕 If countPreferred NOT found, skip direct answer and go to generic ranking
            // HOWEVER: if query is list-intent ("อะไร", "ไหน", "ไรบ้าง") but does NOT have count-intent ("กี่"),
            // return best matching domain item directly (don't show generic list)
            if (isListIntent && !isCountIntent && unblockedMatches.length > 0) {
              // Filter to domain-matched results if domain is clear
              let domainMatched = unblockedMatches;
              
              // Try to find first item that matches query domain
              const queryHasScholarship = Array.isArray(scholarshipTerms) && scholarshipTerms.length > 0 && scholarshipTerms.some(t => msgLower.includes(String(t).toLowerCase()));
              if (queryHasScholarship) {
                console.log(`🔍 queryHasScholarship=true, scholarshipTerms=${scholarshipTerms.join(',')}`);
                const scholarshipMatched = unblockedMatches.filter(m => {
                  const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
                  const textLower = String(m.item.QuestionText || '').toLowerCase();
                  const catLower = String(m.item.CategoriesID || '').toLowerCase();
                  const matched = scholarshipTerms.some(t => {
                    const tLower = String(t).toLowerCase();
                    return titleLower.includes(tLower) || textLower.includes(tLower) || catLower.includes(tLower);
                  });
                  if (matched) {
                    console.log(`  ✓ QA#${m.item.QuestionsAnswersID} matched scholarship domain`);
                  }
                  return matched;
                });
                console.log(`  scholarshipMatched count=${scholarshipMatched.length}`);
                
                // Sort scholarshipMatched by title exactness: items with more query tokens in title first
                if (scholarshipMatched.length > 1) {
                  scholarshipMatched.sort((a, b) => {
                    const aTitleLower = String(a.item.QuestionTitle || '').toLowerCase();
                    const bTitleLower = String(b.item.QuestionTitle || '').toLowerCase();
                    // Count how many query tokens appear in each title
                    const aTokenCount = queryTokens.filter(t => aTitleLower.includes(t.toLowerCase())).length;
                    const bTokenCount = queryTokens.filter(t => bTitleLower.includes(t.toLowerCase())).length;
                    const diff = bTokenCount - aTokenCount;
                    if (diff !== 0) return diff; // More tokens = better match
                    // If tied, use original score order (keyword match quality)
                    return b.score - a.score;
                  });
                  console.log(`  Re-sorted: top now is QA#${scholarshipMatched[0].item.QuestionsAnswersID}`);
                }
                
                if (scholarshipMatched.length > 0) {
                  domainMatched = scholarshipMatched;
                }
              }
              
              if (domainMatched.length > 0) {
                console.log(`🎯 List-intent (non-count) direct answer: QA#${domainMatched[0].item.QuestionsAnswersID}`);
                const formatted = formatAnswer(domainMatched[0].item.QuestionText, domainMatched[0].item.CategoriesID || null, domainMatched[0].item.CategoriesPDF || null);
                return res.status(200).json({
                  success: true,
                  found: true,
                  multipleResults: false,
                  query: message,
                  message: '✨ นี่คือคำตอบที่คุณหา',
                  alternatives: [{
                    id: domainMatched[0].item.QuestionsAnswersID,
                    title: domainMatched[0].item.QuestionTitle,
                    preview: (domainMatched[0].item.QuestionText || '').slice(0, 200),
                    text: formatted.text,
                    summary: formatted.summary,
                    points: formatted.points,
                    sources: formatted.sources,
                    keywords: domainMatched[0].item.keywords,
                    categories: domainMatched[0].item.CategoriesID || null,
                    categoriesPDF: domainMatched[0].item.CategoriesPDF || null
                  }]
                });
              }
            }
            } // end if (isListIntent)
          } catch (listIntentError) {
            // 🔴 Explicit error handling for list-intent logic
            console.error(`❌ List-intent logic error (falling back to generic ranking):`, listIntentError && listIntentError.message);
            console.error(`   Query: "${message}"`);
            console.error(`   Stack:`, listIntentError && listIntentError.stack);
            listIntentHandled = false; // ensure fallback to generic ranking
          }

          // Domain terms already loaded above, just log for debugging
          console.log('[Domain Terms Loaded]:', { dormTerms: dormTerms.length, scholarshipTerms: scholarshipTerms.length, admissionsTerms: admissionsTerms.length });

          // 🛑 Apply session-level blocked domains (sticky until resetConversation)
          if (blockedDomainsFromSession.size > 0) {
            console.log('🚫 Session blocked domains:', Array.from(blockedDomainsFromSession).join(', '));
          }

          // 🔗 Bridge Intent: if user negates domain A but wants domain B, skip to wanted domain directly
          if (bridgeIntent.hasBridgeIntent && bridgeIntent.wantedDomains.length > 0) {
            console.log(`🔗 Bridge Intent shortcut: filtering directly to wanted domains [${bridgeIntent.wantedDomains.join(', ')}]`);
            
            // Get terms for wanted domains
            const wantedTerms = bridgeIntent.wantedDomains.flatMap(d => domainTermsMap[d] || []);

            // Remove any wanted domain that is currently blocked in session
            const allowedWanted = bridgeIntent.wantedDomains.filter(d => !blockedDomainsFromSession.has(d));
            const allowedTerms = allowedWanted.flatMap(d => domainTermsMap[d] || []);
            if (allowedTerms.length === 0) {
              return res.status(200).json({
                success: true,
                found: false,
                message: 'ตอนนี้ปิดหัวข้อที่คุณปฏิเสธไว้ค่ะ หากต้องการเปิดใหม่ให้กดรีเซ็ต (ถังขยะ) แล้วลองอีกครั้งนะคะ',
                bridgeIntent,
                blockedDomains: Array.from(blockedDomainsFromSession),
              });
            }
            
            // 🔗 Filter from FULL qaList (not just keywordMatchesWithScore) to avoid missing wanted domain items
            const bridgeFiltered = qaList.filter(item => {
              const titleLower = String(item.QuestionTitle || '').toLowerCase();
              const textLower = String(item.QuestionText || '').toLowerCase();
              return allowedTerms.some(t => titleLower.includes(t) || textLower.includes(t));
            });
            
            if (bridgeFiltered.length > 0) {
              console.log(`🔗 Bridge found ${bridgeFiltered.length} items matching wanted domains from full corpus`);
              
              // Sort by hybridScore equivalent
              const withBridge = bridgeFiltered.map(item => {
                const bm25 = bm25Score(queryTokens, item, avgDocLen, 1.5, 0.75, idfMap);
                const hybrid = bm25 || 0;
                return { item, bm25, hybridScore: hybrid };
              }).sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));
              
              const count = Math.min(withBridge.length, 5);
              const topBridge = withBridge.slice(0, count);
              
              rankingById = new Map();
              topBridge.forEach(r => {
                rankingById.set(r.item.QuestionsAnswersID, {
                  score: r.hybridScore,
                  breakdown: null,
                  weights: null,
                  negationPenalty: null,
                  negationDetails: [],
                });
              });
              
              return res.status(200).json({
                success: true,
                found: true,
                multipleResults: true,
                query: message,
                message: bridgeIntent.bridgeMessage,
                bridgeIntent: bridgeIntent,
                totalResults: withBridge.length,
                returnedResults: count,
                hiddenResults: Math.max(0, withBridge.length - count),
                alternatives: topBridge.map(r => {
                  const formatted = formatAnswer(r.item.QuestionText, r.item.CategoriesID || null, r.item.CategoriesPDF || null);
                  return {
                    id: r.item.QuestionsAnswersID,
                    title: r.item.QuestionTitle,
                    preview: (r.item.QuestionText || '').slice(0, 200),
                    text: formatted.text,
                    summary: formatted.summary,
                    points: formatted.points,
                    sources: formatted.sources,
                    keywords: r.item.keywords,
                    categories: r.item.CategoriesID || null,
                    categoriesPDF: r.item.CategoriesPDF || null,
                    finalRanking: rankingById.get(r.item.QuestionsAnswersID) || {}
                  };
                })
              });
            }
          }

          // If query mentions a domain (e.g., dorm), prefer filtering to that domain first
          const preFiltered = (() => {
            const qLower = msgLower;
            const containsAny = (terms, sourceLower, kws) =>
              terms.some(t => sourceLower.includes(t) || kws.some(k => k.includes(t)));

            // Only consider domain detection when DB returned domain terms (DB-only)
            const queryHasDorm = Array.isArray(dormTerms) && dormTerms.length > 0 && dormTerms.some(t => qLower.includes(t));
            const queryHasScholarship = Array.isArray(scholarshipTerms) && scholarshipTerms.length > 0 && scholarshipTerms.some(t => qLower.includes(t));
            const queryHasAdmissions = Array.isArray(admissionsTerms) && admissionsTerms.length > 0 && admissionsTerms.some(t => qLower.includes(t));

            // Logging for debugging domain behavior (DB-only)
            console.log('Domain detection (DB-only):', { query: msgLower, dormTermsLoaded: dormTerms.length, scholarshipTermsLoaded: scholarshipTerms.length, admissionsTermsLoaded: admissionsTerms.length, queryHasDorm, queryHasScholarship, queryHasAdmissions });

            if (queryHasDorm && !blockedDomainsFromSession.has('dorm')) {
              const onlyDorm = unblockedMatches.filter(m => {
                const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
                const textLower = String(m.item.QuestionText || '').toLowerCase();
                // 🆕 Only check title + text, NOT keywords (to avoid auto-learned contamination)
                const fullText = titleLower + ' ' + textLower;
                // Require at least one dorm term to be in TITLE or TEXT (not just keywords)
                return dormTerms.some(t => fullText.includes(t));
              });
              if (onlyDorm.length > 0) {
                console.log('Filtered to dorm domain: items', onlyDorm.length);
                // mark domain for later stricter filtering
                onlyDorm._domain = 'dorm';
                return onlyDorm;
              }
            }
            if (queryHasScholarship && !blockedDomainsFromSession.has('scholarship')) {
              const onlyScholar = unblockedMatches.filter(m => {
                const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
                const textLower = String(m.item.QuestionText || '').toLowerCase();
                // 🆕 Only check title + text, NOT keywords
                const fullText = titleLower + ' ' + textLower;
                return scholarshipTerms.some(t => fullText.includes(t));
              });
              if (onlyScholar.length > 0) {
                console.log('Filtered to scholarship domain: items', onlyScholar.length);
                onlyScholar._domain = 'scholarship';
                return onlyScholar;
              }
            }
            if (queryHasAdmissions && !blockedDomainsFromSession.has('admissions')) {
              const onlyAdm = unblockedMatches.filter(m => {
                const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
                const textLower = String(m.item.QuestionText || '').toLowerCase();
                // 🆕 Only check title + text, NOT keywords
                const fullText = titleLower + ' ' + textLower;
                return admissionsTerms.some(t => fullText.includes(t));
              });
              if (onlyAdm.length > 0) {
                console.log('Filtered to admissions domain: items', onlyAdm.length);
                onlyAdm._domain = 'admissions';
                return onlyAdm;
              }
            }
            return unblockedMatches;
          })();

          // 🆕 Narrow intent handling: if user query is specific, require title/text to contain all query tokens
          let narrowed = preFiltered;
          let isNarrow = false;
          let isNarrowScholarship = false;
          try {
            // Determine active domain from pre-filter stage (before scoring)
            const domainName = (preFiltered && preFiltered._domain) ? preFiltered._domain : null;
            const qLowerFull = String(msgLower || '').trim();
            const isSpecificPhrase = qLowerFull.length >= 8; // heuristic: long phrase → specific intent
            const meaningfulTokens = (Array.isArray(queryTokens) ? queryTokens : []).filter(t => String(t||'').length >= 2);
            // DB-driven: only treat scholarship as "narrow" if query matches scholarship terms that themselves mention foreign context (ต่างชาติ/ต่างประเทศ)
            const narrowScholarshipTerms = Array.isArray(scholarshipTerms)
              ? scholarshipTerms.filter(t => /ต่างชาติ|ต่างประเทศ/.test(String(t)))
              : [];
            const isSpecificScholarship = domainName === 'scholarship' && narrowScholarshipTerms.length > 0 && narrowScholarshipTerms.some(p => qLowerFull.includes(String(p).toLowerCase()));
            // Skip narrowing for list-intent queries; list should stay broad and DB-driven
            if (!isListIntent && ((domainName && isSpecificPhrase && meaningfulTokens.length > 0) || isSpecificScholarship)) {
              const containsAllTokens = (text) => meaningfulTokens.every(t => String(text).includes(String(t).toLowerCase()));
              const strict = preFiltered.filter(m => {
                const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
                const textLower = String(m.item.QuestionText || '').toLowerCase();
                const full = `${titleLower} ${textLower}`;
                // DB-driven phrase/category checks: use scholarship terms from DB, avoid hardcoded phrases/regex
                const phraseHit = isSpecificScholarship ? narrowScholarshipTerms.some(p => full.includes(String(p).toLowerCase())) : full.includes(qLowerFull);
                const catLower = String(m.item.CategoriesID || '').toLowerCase();
                const categoryHit = isSpecificScholarship ? narrowScholarshipTerms.some(t => catLower.includes(String(t).toLowerCase())) : false;
                // For scholarship-specific narrowing, require all tokens to be present AND (phrase/category hit)
                if (isSpecificScholarship) {
                  return containsAllTokens(full) && (phraseHit || categoryHit);
                }
                return phraseHit || categoryHit || containsAllTokens(full);
              });
              let chosen = strict;
              // If too few strict matches (aim for 2), fallback: pick items with any scholarship term in title/text/category
              if (isSpecificScholarship && chosen.length < 2) {
                const existingIds = new Set(chosen.map(x => x.item && x.item.QuestionsAnswersID));
                const fallback = preFiltered.filter(m => {
                  if (existingIds.has(m.item.QuestionsAnswersID)) return false;
                  const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
                  const textLower = String(m.item.QuestionText || '').toLowerCase();
                  const catLower = String(m.item.CategoriesID || '').toLowerCase();
                  return scholarshipTerms.some(t => titleLower.includes(String(t).toLowerCase()) || textLower.includes(String(t).toLowerCase()) || catLower.includes(String(t).toLowerCase()));
                }).slice(0, Math.max(0, 2 - chosen.length));
                chosen = [...chosen, ...fallback];
              }
              if (chosen.length > 0) {
                console.log(`🔎 Narrowed intent applied: reduced ${preFiltered.length} → ${chosen.length}`);
                chosen._domain = preFiltered._domain;
                chosen._narrowScholarship = !!isSpecificScholarship;
                narrowed = chosen;
                isNarrow = true;
                isNarrowScholarship = !!isSpecificScholarship;
              }
            }
          } catch (_) {}

          const withHybridScore = narrowed.map(m => {
            const bm25 = bm25Score(queryTokens, m.item, avgDocLen, 1.5, 0.75, idfMap);
            const c = m.components || { overlap: 0, title: 0, semantic: 0 };
            const blended = (0.5 * (c.title || 0)) + (0.35 * (c.semantic || 0)) + (0.15 * (c.overlap || 0));
            // Blend BM25 as an additional strong signal for lexical matching
            let hybrid = (0.6 * blended) + (0.4 * (bm25 || 0));

            // 🆕 Final Ranking: map existing signals → weighted score
            const hasDomainHit = (() => {
              const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
              const textLower = String(m.item.QuestionText || '').toLowerCase();
              if (dormTerms.some(t => titleLower.includes(t) || textLower.includes(t))) return true;
              if (scholarshipTerms.some(t => titleLower.includes(t) || textLower.includes(t))) return true;
              if (admissionsTerms.some(t => titleLower.includes(t) || textLower.includes(t))) return true;
              return false;
            })();

            const clamp01 = (v) => Math.min(1, Math.max(0, v || 0));
            // Normalize signals to 0-1 (less aggressive; keep signals non-zero)
            const applicationNorm = clamp01((bm25 || 0) / 2); // BM25 soft scale
            const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
            const textLower = String(m.item.QuestionText || '').toLowerCase();
            const rawTitleHit = titleLower.includes(msgLower);
            const rawTokenHit = Array.isArray(queryTokens) && queryTokens.some(t => titleLower.includes(String(t).toLowerCase()) || textLower.includes(String(t).toLowerCase()));

            const coreRaw = Math.max(c.title || 0, c.semanticTitle || 0, c.semantic || 0, rawTitleHit ? 0.6 : 0, rawTokenHit ? 0.4 : 0);
            const coreNorm = clamp01(coreRaw / 2);
            const synonymRaw = Math.max(c.semanticKw || 0, c.semanticText || 0, c.semanticTitle || 0, c.semantic || 0, rawTokenHit ? 0.3 : 0);
            const synonymNorm = clamp01(synonymRaw / 3);
            const overlapNorm = clamp01((c.overlap || 0) / 2);

            // 🆕 Keep domain_support from collapsing to 0 when domain terms are empty by reusing lexical hits
            const domainRaw = Math.max(
              hasDomainHit ? 1 : 0,
              overlapNorm,
              rawTitleHit ? 0.6 : 0,
              rawTokenHit ? 0.5 : 0
            );
            const domainNorm = clamp01(domainRaw);

            const rankingInput = {
              core: coreNorm,
              synonym_support: synonymNorm,
              domain_support: domainNorm,
              application_support: applicationNorm,
            };
            let finalRank = null;
            try {
              finalRank = calculateFinalRanking(rankingInput);
            } catch (e) {
              finalRank = null;
            }
            let finalScore = finalRank?.total ?? hybrid;

            // ⛔ Apply negation penalty based on original tokens vs item keywords (Look Backward)
            let negationPenalty = 1.0;
            const negationDetails = [];
            const itemKeywords = (m.item.keywords || []).map(k => String(k || '').toLowerCase());
            for (const kw of itemKeywords) {
              const neg = checkNegation(originalTokens, kw);
              if (neg.isNegated) {
                negationPenalty = Math.min(negationPenalty, neg.modifier);
                negationDetails.push({ keyword: kw, negativeWord: neg.negativeWord, modifier: neg.modifier });
              }
            }
            if (negationPenalty !== 1.0) {
              const beforePenalty = finalScore;
              finalScore = finalScore * negationPenalty;
              console.log(`⛔ Negation penalty applied to "${m.item.QuestionTitle}": ${beforePenalty.toFixed(3)} -> ${finalScore.toFixed(3)} (x${negationPenalty})`);
            }

            hybrid = finalScore;

            // 🆕 Domain-aware boosts: if query mentions specific domain terms, prefer matching QAs
            const queryLower = msgLower;
            const kwTexts = (m.item.keywords || []).map(k => String(k).toLowerCase());

            const containsAny = (terms, sourceLower, kws) =>
              terms.some(t => sourceLower.includes(t) || kws.some(k => k.includes(t)));

            const queryHasDorm = dormTerms.some(t => queryLower.includes(t));
            const queryHasScholarship = scholarshipTerms.some(t => queryLower.includes(t));
            const queryHasAdmissions = admissionsTerms.some(t => queryLower.includes(t));

            if (queryHasDorm) {
              // 🆕 Only check title+text, not keywords, to avoid false positives from auto-learn
              const itemIsDorm = dormTerms.some(t => titleLower.includes(t) || textLower.includes(t));
              hybrid += itemIsDorm ? 1.0 : -1.2; // 🆕 Stronger boost/penalty to eliminate cross-domain leakage
            }
            if (queryHasScholarship) {
              const itemIsScholarship = scholarshipTerms.some(t => titleLower.includes(t) || textLower.includes(t));
              const catLower = String(m.item.CategoriesID || '').toLowerCase();
              
              // 🆕 Check scholarship subdomain match specifically
              // "ทุนเรียนดี" (cat 1-1), "ทุนช่วยเหลือ" (cat 1-4) are different subdomains
              const queryHasThanChwyHlue = scholarshipTerms.some(t => 
                msgLower.includes(String(t).toLowerCase()) && String(t).toLowerCase().includes('ช่วยเหลือ')
              );
              
              if (queryHasThanChwyHlue && !itemIsScholarship) {
                // If query explicitly asks about "ทุนช่วยเหลือ" but item is NOT scholarship, massive penalty
                hybrid -= 3.0;
              } else if (queryHasThanChwyHlue && itemIsScholarship) {
                // If query asks "ทุนช่วยเหลือ" and item has scholarship terms, boost heavily
                const isSameSubdomain = catLower.includes('ทุนช่วยเหลือ') || catLower.includes('1-4');
                hybrid += isSameSubdomain ? 3.0 : 1.5;
              } else if (itemIsScholarship) {
                hybrid += 1.0;
              } else {
                hybrid -= 0.8;
              }
            }
            if (queryHasAdmissions) {
              const itemIsAdmissions = admissionsTerms.some(t => titleLower.includes(t) || textLower.includes(t));
              hybrid += itemIsAdmissions ? 0.6 : -0.4; // 🆕 Increased penalties
            }
            // 🆕 Extra boost for count-focused Q&A when detecting count intent
            if (isCountIntent) {
              const titleLower2 = String(m.item.QuestionTitle || '').toLowerCase();
              const textLower2 = String(m.item.QuestionText || '').toLowerCase();
              const hasTitleHint = Array.isArray(countHints)
                ? countHints.some(h => titleLower2.includes(String(h).toLowerCase()))
                : false;
              const hasTextHint = Array.isArray(countHints)
                ? countHints.some(h => textLower2.includes(String(h).toLowerCase()))
                : false;
              const extraBoost = (hasTitleHint ? 0.12 : 0) + (hasTextHint ? 0.08 : 0);
              hybrid += extraBoost;
            }
            // 🆕 Extra boost for "list-intent" queries (อะไรบ้าง, มีอะไร)
            // Priority: QA title containing "กี่" or "ประเภท" (direct list answers) > QA with keywords
            if (isListIntent) {
              const titleLower = String(m.item.QuestionTitle || '').toLowerCase();
              // Detect document-intent using DB-loaded hints
              const docIntent = Array.isArray(docHints) && docHints.some(h => queryLower.includes(String(h).toLowerCase()));
              const hasDocInItem = Array.isArray(docHints) && docHints.some(h => titleLower.includes(String(h).toLowerCase()) || textLower.includes(String(h).toLowerCase()));

              if (/กี่/.test(titleLower) && !docIntent) {
                hybrid += 0.8; // Highest boost for direct "กี่" titles when not doc intent
              } else if (/ประเภท|ไหน|ไรบ้าง/.test(titleLower) && !docIntent) {
                hybrid += 0.6; // Strong boost for other list patterns
              } else {
                const kwTexts = (m.item.keywords || []).map(k => String(k).toLowerCase());
                // Use list hints from DB instead of hardcoded array
                const hasListKeyword = Array.isArray(listHints) && listHints.some(lk => {
                  const lkLower = String(lk).toLowerCase();
                  return kwTexts.some(kw => kw.includes(lkLower) || lkLower.includes(kw));
                });
                if (hasListKeyword && !docIntent) {
                  hybrid += 0.3; // Moderate boost for matching list-intent keywords (non-doc intent)
                }
              }

              // Document intent: boost items that mention required docs / usage, lightly penalize others
              if (docIntent) {
                if (hasDocInItem) {
                  hybrid += 1.2; // strong boost for document-related answers
                } else {
                  hybrid -= 0.9; // strong penalty for non-document answers when doc intent
                }
              }
            }
            return {
              ...m,
              bm25,
              blended,
              hybridScore: hybrid,
              rankingBreakdown: finalRank?.breakdown || null,
              rankingWeights: finalRank?.weights || null,
              negationPenalty: negationPenalty !== 1.0 ? negationPenalty : null,
              negationDetails,
              components: c,
            };
          }).sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0));

          // If preFiltered was domain-specific, apply a minimum hybrid score threshold to avoid noisy matches
          const domainName = (narrowed && narrowed._domain) ? narrowed._domain : (preFiltered && preFiltered._domain ? preFiltered._domain : null);
          const isVeryShortQuery = ((message || '').trim().length <= 4) || ((queryTokens || []).length <= 1);
          let reranked = withHybridScore;

          // ⛔ If the user negated keywords, drop penalized items to avoid suggesting what they refused
          if (negationAnalysis.hasNegation) {
            const nonNegated = reranked.filter(r => !(r.negationPenalty && r.negationPenalty < 1));
            if (nonNegated.length !== reranked.length) {
              console.log(`⛔ Negation filter removed ${reranked.length - nonNegated.length} items due to user negation.`);
            }

            // 🔗 Bridge Intent: if user negates domain A but wants domain B, filter to domain B only
            if (bridgeIntent.hasBridgeIntent && bridgeIntent.wantedDomains.length > 0) {
              console.log(`🔗 Bridge filtering: keeping only wanted domains [${bridgeIntent.wantedDomains.join(', ')}]`);
              
              // Get terms for wanted domains
              const wantedTerms = bridgeIntent.wantedDomains.flatMap(d => domainTermsMap[d] || []);
              
              // Filter to items matching wanted domain (in title/text, not just keywords)
              const bridgeFiltered = reranked.filter(r => {
                const titleLower = String(r.item.QuestionTitle || '').toLowerCase();
                const textLower = String(r.item.QuestionText || '').toLowerCase();
                return wantedTerms.some(t => titleLower.includes(t) || textLower.includes(t));
              });
              
              if (bridgeFiltered.length > 0) {
                console.log(`🔗 Bridge found ${bridgeFiltered.length} items matching wanted domains`);
                reranked = bridgeFiltered;
                
                // Return with bridge message
                const count = Math.min(bridgeFiltered.length, 5);
                const topBridge = bridgeFiltered.slice(0, count);
                
                rankingById = new Map();
                topBridge.forEach(r => {
                  rankingById.set(r.item.QuestionsAnswersID, {
                    score: r.hybridScore,
                    breakdown: r.rankingBreakdown || null,
                    weights: r.rankingWeights || null,
                    negationPenalty: r.negationPenalty || null,
                    negationDetails: r.negationDetails || [],
                  });
                });
                
                return res.status(200).json({
                  success: true,
                  found: true,
                  multipleResults: true,
                  query: message,
                  message: bridgeIntent.bridgeMessage,
                  bridgeIntent: bridgeIntent,
                  totalResults: bridgeFiltered.length,
                  returnedResults: count,
                  hiddenResults: Math.max(0, bridgeFiltered.length - count),
                  alternatives: topBridge.map(r => {
                    const formatted = formatAnswer(r.item.QuestionText, r.item.CategoriesID || null, r.item.CategoriesPDF || null);
                    return {
                      id: r.item.QuestionsAnswersID,
                      title: r.item.QuestionTitle,
                      preview: (r.item.QuestionText || '').slice(0, 200),
                      text: formatted.text,
                      summary: formatted.summary,
                      points: formatted.points,
                      sources: formatted.sources,
                      keywords: r.item.keywords,
                      categories: r.item.CategoriesID || null,
                      categoriesPDF: r.item.CategoriesPDF || null,
                      finalRanking: rankingById.get(r.item.QuestionsAnswersID) || {}
                    };
                  })
                });
              }
            }

            if (nonNegated.length === 0) {
              return res.status(200).json({
                success: true,
                found: false,
                message: `โอเคค่ะ ${BOT_PRONOUN}ยกเลิกหัวข้อนี้ให้แล้ว คุณอยากคุยเรื่องไหนต่อดีคะ?`,
                negationInfo: negationAnalysis,
                results: []
              });
            }

            reranked = nonNegated;
          }
          // สำหรับคำสั้นมาก (เช่น "ทุน?") ไม่ต้องใช้ domain threshold เพื่อให้ได้หลายผลลัพธ์มากขึ้น
          if (domainName && !isVeryShortQuery) {
            const minHybrid = parseFloat(process.env.DOMAIN_THRESHOLD) || 0.40;
            const fallbackHybrid = parseFloat(process.env.DOMAIN_FALLBACK_THRESHOLD) || 0.25;
            console.log('Applying domain threshold', { domain: domainName, minHybrid, fallbackHybrid });
            
            // 🆕 Log all scores before filtering
            console.log(`[Domain Scores] All ${withHybridScore.length} items (before filtering):`);
            withHybridScore.forEach((r, idx) => {
              console.log(`  ${idx+1}. ID${r.item.QuestionsAnswersID}: "${r.item.QuestionTitle}" (score: ${(r.hybridScore || 0).toFixed(3)})`);
            });
            
            reranked = reranked.filter(r => (r.hybridScore || 0) >= minHybrid);
            
            // 🆕 Log results after filtering
            console.log(`[Domain Filtered] ${reranked.length} items passed threshold ${minHybrid}:`);
            reranked.forEach((r, idx) => {
              console.log(`  ${idx+1}. ID${r.item.QuestionsAnswersID}: score ${(r.hybridScore || 0).toFixed(3)}`);
            });
            
            if (reranked.length === 0) {
              console.log(`After applying threshold no items left; relaxing threshold to ${fallbackHybrid}`);
              reranked = withHybridScore.filter(r => (r.hybridScore || 0) >= fallbackHybrid);
              if (reranked.length === 0) {
                reranked = withHybridScore; // final fallback
              }
            }
          }

          // Final safety: remove any blocked domains from reranked list
          if (blockedDomainsFromSession.size > 0) {
            const before = reranked.length;
            reranked = reranked.filter(r => {
              const titleLower = String(r.item.QuestionTitle || '').toLowerCase();
              const textLower = String(r.item.QuestionText || '').toLowerCase();
              if (blockedDomainsFromSession.has('scholarship') && (titleLower.includes('ทุน') || textLower.includes('ทุน'))) return false;
              if (blockedDomainsFromSession.has('dorm') && (titleLower.includes('หอ') || textLower.includes('หอ'))) return false;
              if (blockedDomainsFromSession.has('admissions') && (titleLower.includes('รับสมัคร') || textLower.includes('สมัคร'))) return false;
              return true;
            });
            if (reranked.length === 0) {
              return res.status(200).json({
                success: true,
                found: false,
                message: 'ตอนนี้ปิดหัวข้อที่คุณปฏิเสธไว้ค่ะ ถ้าต้องการดูหัวข้อเดิมอีกครั้ง ให้กดรีเซ็ต (ถังขยะ) แล้วลองใหม่ได้นะคะ',
                blockedDomains: Array.from(blockedDomainsFromSession),
                results: []
              });
            }
            console.log(`🚫 Removed ${before - reranked.length} items due to session domain blocks`);
          }

          // 🆕 Final safety: remove any blocked keywords from reranked list
          // Formula: คำปฏิเสธ - (คำพร้อง+คำสำคัญ) = items with those keywords blocked
          if (blockedKeywordsFromSession.size > 0) {
            const before = reranked.length;
            reranked = reranked.filter(r => {
              const itemKeywords = (r.item.keywords || []).map(k => String(k || '').toLowerCase());
              const titleLower = String(r.item.QuestionTitle || '').toLowerCase();
              const textLower = String(r.item.QuestionText || '').toLowerCase();
              
              for (const blocked of blockedKeywordsFromSession) {
                // 1️⃣ Check keywords array
                if (itemKeywords.some(kw => kw === blocked)) {
                  console.log(`🚫 Final filter: keywords [${itemKeywords.join(', ')}] blocked due to "${blocked}"`);
                  return false;
                }
                
                // 2️⃣ Check title contains blocked keyword
                if (titleLower.includes(blocked)) {
                  console.log(`🚫 Final filter: title "${titleLower.substring(0, 50)}..." blocked due to "${blocked}"`);
                  return false;
                }
                
                // 3️⃣ Check text contains blocked keyword
                if (textLower.includes(blocked)) {
                  console.log(`🚫 Final filter: text blocked due to "${blocked}"`);
                  return false;
                }
                
                // 4️⃣ Check synonyms
                for (const [synonym, target] of Object.entries(SYNONYMS_MAPPING)) {
                  if (target === blocked) {
                    if (itemKeywords.some(kw => kw === synonym)) {
                      console.log(`🚫 Final filter: blocked via synonym "${synonym}" of "${blocked}" in keywords`);
                      return false;
                    }
                    if (titleLower.includes(synonym)) {
                      console.log(`🚫 Final filter: blocked via synonym "${synonym}" of "${blocked}" in title`);
                      return false;
                    }
                  }
                }
              }
              return true;
            });
            if (before !== reranked.length) {
              console.log(`🚫 Removed ${before - reranked.length} items due to session keyword blocks: [${Array.from(blockedKeywordsFromSession).join(', ')}]`);
            }
            if (reranked.length === 0) {
              return res.status(200).json({
                success: true,
                found: false,
                message: `ตอนนี้ปิดหัวข้อที่คุณปฏิเสธไว้ค่ะ ถ้าต้องการดูหัวข้อเดิมอีกครั้ง ให้กดรีเซ็ต (ถังขยะ) แล้วลองใหม่ได้นะคะ`,
                blockedDomains: Array.from(blockedDomainsFromSession),
                blockedKeywords: Array.from(blockedKeywordsFromSession),
                results: []
              });
            }
          }

          rankingById = new Map();
          reranked.forEach(r => {
            rankingById.set(r.item.QuestionsAnswersID, {
              score: r.hybridScore,
              breakdown: r.rankingBreakdown || null,
              weights: r.rankingWeights || null,
              negationPenalty: r.negationPenalty || null,
              negationDetails: r.negationDetails || [],
            });
          });

          const topKeywordMatches = reranked.map(m => m.item);

          // Reduce result count when user provides multiple keywords: prefer items with highest matchCount only.
          const queryTokenCount = Array.isArray(queryTokens) ? queryTokens.length : 0;
          let filteredReranked = reranked;

          if (queryTokenCount >= 2) {
            // Find the maximum matchCount among candidates and keep only those with that maximum
            try {
              const counts = filteredReranked.map(r => Number(r.matchCount || 0));
              const maxMatch = counts.length > 0 ? Math.max(...counts) : 0;
              if (maxMatch > 0) {
                filteredReranked = filteredReranked.filter(r => (r.matchCount || 0) === maxMatch);
                console.log(`🔎 Restricting to ${filteredReranked.length} item(s) with max matchCount=${maxMatch}`);
              }
            } catch (err) {
              console.warn('Error while selecting max matchCount items:', err && err.message);
            }
          }

          // 🆕 Use configurable result limits from environment
          const isCountOrListIntent = isCountIntent || isListIntent;
          const maxCountList = parseInt(process.env.MAX_COUNT_LIST_RESULTS) || 3;
          const maxGeneric = parseInt(process.env.MAX_GENERIC_RESULTS) || 5;
          let desired = isCountOrListIntent ? maxCountList : (isNarrowScholarship ? 2 : maxGeneric);

          // Shrink desired proportionally to the number of query tokens so that more tokens => fewer results
          if (queryTokenCount >= 2) {
            desired = Math.max(1, Math.ceil(desired / queryTokenCount));
          }

          if (isVeryShortQuery && !isCountOrListIntent) {
            desired = Math.max(maxGeneric, 5); // คำสั้นให้เห็นหลายตัวเลือก
          }

          // If we filtered the reranked list, use it to build topKeywordMatches
          const topMatchesSource = filteredReranked;
          const topKeywordMatchesFiltered = topMatchesSource.map(m => m.item);

          // 🆕 Domain-aware expansion: if we have fewer than desired and a domain is active, add extra domain items from corpus
          if (!isNarrow && domainName && topKeywordMatchesFiltered.length < desired) {
            const existingIds = new Set(topKeywordMatchesFiltered.map(it => it.QuestionsAnswersID));
            const domainTermsMap = {
              dorm: dormTerms,
              scholarship: scholarshipTerms,
              admissions: admissionsTerms,
            };
            const terms = domainTermsMap[domainName] || [];
            
            // 🚫 Helper function to check if item contains blocked keywords
            const isItemBlockedForExpansion = (item) => {
              if (blockedKeywordsFromSession.size === 0) return false;
              const titleLower = String(item.QuestionTitle || '').toLowerCase();
              const textLower = String(item.QuestionText || '').toLowerCase();
              const itemKeywords = (item.keywords || []).map(k => String(k || '').toLowerCase());
              
              for (const blocked of blockedKeywordsFromSession) {
                if (itemKeywords.some(kw => kw === blocked)) return true;
                if (titleLower.includes(blocked)) return true;
                if (textLower.includes(blocked)) return true;
              }
              return false;
            };
            
            const extraCandidates = qaList.filter(it => {
              if (!it || !it.QuestionTitle) return false;
              if (existingIds.has(it.QuestionsAnswersID)) return false;
              // 🚫 Skip blocked items
              if (isItemBlockedForExpansion(it)) {
                console.log(`🚫 Domain expansion skipped blocked item: "${it.QuestionTitle?.substring(0, 40)}..."`);
                return false;
              }
              const txt = `${it.QuestionTitle || ''} ${it.QuestionText || ''}`.toLowerCase();
              return terms.some(t => txt.includes(t));
            }).map(it => ({
              item: it,
              bm25: bm25Score(queryTokens, it, avgDocLen, 1.5, 0.75, idfMap),
            })).sort((a, b) => (b.bm25 || 0) - (a.bm25 || 0));
            const need = desired - topKeywordMatches.length;
            const toAdd = extraCandidates.slice(0, need).map(e => e.item);
            if (toAdd.length > 0) {
              console.log(`🔁 Domain expansion added ${toAdd.length} extra ${domainName} items to reach ${desired}.`);
              topKeywordMatches.push(...toAdd);
            }
          }
          const unlimitedEnv = String(process.env.MAX_GENERIC_RESULTS_UNLIMITED || '').toLowerCase() === 'true';
          const unlimited = (!isNarrow && unlimitedEnv) || (isVeryShortQuery && !isCountOrListIntent);
          const totalAvailable = topKeywordMatches.length;
          const count = unlimited && !isCountOrListIntent ? totalAvailable : Math.min(totalAvailable, desired);
          
          // 🆕 Determine search context for logging
          let searchContext = 'generic search';
          if (domainName) searchContext = `${domainName} domain search`;
          if (isCountOrListIntent) searchContext = 'count/list intent';
          
          const hidden = totalAvailable - count;
          console.log(`🏅 Returning ${count}/${totalAvailable} relevant matches (${searchContext})${isNarrow?' • narrow-intent':''}${hidden>0?` • hidden=${hidden}`:''}`);
          
          // 🧠 Auto-learn: บันทึก tokens เมื่อค้นหาสำเร็จ (multiple results with good hybrid score)
          if (reranked.length > 0 && reranked[0].hybridScore >= 0.5) {
          }
          
          // 🆕 Fetch officer contacts for domain/generic search
          let domainContacts = [];
          try {
            // Get QuestionsAnswersIDs from the results
            const qaIds = topKeywordMatches.slice(0, count).map(item => item.QuestionsAnswersID).filter(id => !!id);
            if (qaIds && qaIds.length > 0) {
              const [rows] = await connection.query(
                `SELECT DISTINCT o.OfficerID, o.OfficerName AS officer, o.OfficerPhone AS phone, org.OrgName AS organization
                 FROM Officers o
                 LEFT JOIN Organizations org ON o.OrgID = org.OrgID
                 INNER JOIN QuestionsAnswers qa ON qa.OfficerID = o.OfficerID
                 WHERE qa.QuestionsAnswersID IN (?) AND o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
                 ORDER BY org.OrgName ASC`,
                [qaIds]
              );
              if (rows && rows.length > 0) {
                const mapped = rows.map(r => ({
                  organization: r.organization || null,
                  officer: r.officer || null,
                  phone: r.phone || null
                }));
                const dedup = [];
                const seen = new Set();
                for (const c of mapped) {
                  const key = `${c.officer || ''}::${c.phone || ''}`;
                  if (!seen.has(key)) { seen.add(key); dedup.push(c); }
                }
                domainContacts = dedup;
              }
            }
          } catch (contactErr) {
            console.warn('Failed to load officer contacts for domain search:', contactErr && contactErr.message);
          }
          
          return res.status(200).json({
            success: true,
            found: true,
            multipleResults: true,
            query: message,
            message: isCountOrListIntent
              ? `🧮 พบ ${count} คำถามที่สรุปจำนวน/ประเภท\n(เลือกอันที่ตรงใจที่สุดได้เลย)`
              : (unlimited
                ? `😊 พบทั้งหมด ${totalAvailable} คำถามที่เกี่ยวข้อง\nลองเลือกดูที่ตรงใจได้เลย`
                : `😊 พบ ${count} คำถามที่เกี่ยวข้อง\nลองเลือกดูที่ตรงใจได้เลย`),
            totalResults: totalAvailable,
            returnedResults: count,
            hiddenResults: hidden,
            contacts: domainContacts,
            negationInfo: negationAnalysis.hasNegation ? {
              hasNegation: true,
              negatedKeywords: negationAnalysis.negatedKeywords,
              negativeWordsFound: negationAnalysis.negativeWordsFound
            } : null,
            alternatives: topKeywordMatches.slice(0, count).map(item => {
              const rankInfo = rankingById.get(item.QuestionsAnswersID) || {};
              const formatted = formatAnswer(item.QuestionText, item.CategoriesID || null, item.CategoriesPDF || null);
              return {
                id: item.QuestionsAnswersID,
                title: item.QuestionTitle,
                preview: (item.QuestionText || '').slice(0, 200),
                text: formatted.text,
                summary: formatted.summary,
                points: formatted.points,
                sources: formatted.sources,
                keywords: item.keywords,
                categories: item.CategoriesID || null,
                categoriesPDF: item.CategoriesPDF || null,
                finalRanking: rankInfo
              };
            })
          });
        }
      }
    }

    // No match fallback with contacts
    if (!best || (!isTitleExact && !hasAnyOverlap)) {
      // Extra fallback: foreign scholarships hint
      const msgLower = String(message || '').toLowerCase();
      if (msgLower.includes('ต่างประเทศ') || msgLower.includes('ศึกษาต่อต่างประเทศ')) {
        return res.status(200).json({
          success: true,
          found: false,
          message: '🌏 ตอนนี้ยังไม่มีข้อมูลทุนศึกษาต่อต่างประเทศโดยตรง\nแต่ฉันแนะนำให้ดูหมวดทุนทั่วไปรวมถึงลิงก์ PDF แนบ แล้วสอบถามเจ้าหน้าที่เพิ่มเติมได้เลยนะ',
          suggestions: [
            {
              title: 'ดูหมวดทุนการศึกษา',
              url: null
            },
            {
              title: 'ติดต่อเจ้าหน้าที่ทุนการศึกษา',
              url: null
            }
          ]
        });
      }

      const noKeywordMatches = !keywordMatches || keywordMatches.length === 0;
      if (noKeywordMatches) {
        // Get default contact from config/DB (do NOT hardcode)
        const { getDefaultContact } = require('../../utils/getDefaultContact');
        const defaultContact = await getDefaultContact(connection);

        try {
          const [contactsRows] = await connection.query(
            `SELECT DISTINCT org.OrgName AS organization, o.OfficerName AS officer, o.OfficerPhone AS phone
             FROM Officers o
             LEFT JOIN Organizations org ON o.OrgID = org.OrgID
             WHERE o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
             ORDER BY org.OrgName ASC
             LIMIT 50`
          );

          const { formatThaiPhone } = require('../../utils/formatPhone');
          let contacts = (contactsRows || []).map(r => ({
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
          if (preferred) { contacts = [preferred]; console.log('Selected preferred contact from contactsRows:', preferred); }

          // If no contacts found, try to prefer a real officer from DB that matches the expected default
          if (!contacts || contacts.length === 0) {
            try {
              const [dbDefault] = await connection.query(
                `SELECT o.OfficerPhone AS phone, o.OfficerName AS officer, org.OrgName AS organization
                 FROM Officers o
                 LEFT JOIN Organizations org ON o.OrgID = org.OrgID
                 WHERE (REPLACE(o.OfficerName, '…', '') LIKE ? OR REPLACE(REPLACE(org.OrgName, '\\t', ''), '…', '') LIKE ?) AND o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
                 LIMIT 1`, ['%วิพาด%', '%ส่งเสริม%']
              );
              if (dbDefault && dbDefault.length > 0) {
                const r = dbDefault[0];
                console.log('Using DB default contact for fallback:', r);
                contacts = [{
                  organization: r.organization || defaultContact.organization,
                  officer: r.officer || defaultContact.officer,
                  phone: r.phone || defaultContact.phone,
                  officerPhoneRaw: r.phone || defaultContact.officerPhoneRaw,
                  officerPhone: r.phone ? formatThaiPhone(r.phone) : defaultContact.officerPhone
                }];
              } else {
                console.log('No DB contact found for default; using static default');
                contacts = [defaultContact];
              }
            } catch (e) {
              console.error('Error fetching default contact from DB', e && (e.message || e));
              contacts = [defaultContact];
            }
          }

          return res.status(200).json({
            success: true,
            found: false,
            message: `😅 ขออภัยนะ ฉันค่อนข้างงงกับคำถามนี้\n\nถ้าต้องการความช่วยเหลือ ลองติดต่อทีมที่เกี่ยวข้องของมหาวิทยาลัยได้นะ ฉันจะให้ข้อมูลติดต่อให้`,
            contacts
          });
        } catch (cErr) {
          console.error('Error fetching officer contacts:', cErr && cErr.message);
          // If defaultContact is available, return it; otherwise, try to return officers who authored QAs
          let fallbackContacts = [];
          if (defaultContact) {
            fallbackContacts = Array.isArray(defaultContact) ? defaultContact : [defaultContact];
          } else {
            try {
              const [qaOfficers] = await connection.query(
                `SELECT DISTINCT o.OfficerID, o.OfficerName AS officer, o.OfficerPhone AS phone, org.OrgName AS organization
                 FROM Officers o
                 LEFT JOIN Organizations org ON o.OrgID = org.OrgID
                 INNER JOIN QuestionsAnswers qa ON qa.OfficerID = o.OfficerID
                 WHERE o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
                 ORDER BY qa.QuestionsAnswersID DESC
                 LIMIT 5`
              );
              fallbackContacts = (qaOfficers || []).map(r => ({ organization: r.organization || null, officer: r.officer || null, phone: r.phone || null, officerPhoneRaw: r.phone || null, officerPhone: r.phone ? formatThaiPhone(r.phone) : null })).filter(Boolean);
            } catch (e) {
              console.error('Error fetching QA officers for fallback:', e && e.message);
            }
          }

          return res.status(200).json({
            success: true,
            found: false,
            message: `😓 ขออภัยจริงๆ ฉันไม่มีข้อมูลเกี่ยวกับคำถามนี้\n\n`,
            contacts: fallbackContacts
          });
        }
      }

      return res.status(200).json({
        success: true,
        found: false,
        message: '🤔 หืม... ฉันหาคำตอบที่แน่นอนไม่เจอ\n\nแต่อาจจะเกี่ยวข้องกับสิ่งนี้นะ (อาจจะช่วยได้):',
        results: ranked.slice(0, 1).map(r => ({
          id: r.item.QuestionsAnswersID,
          title: r.item.QuestionTitle,
          preview: (r.item.QuestionText || '').slice(0, 200),
          score: r.score.toFixed(2),
        }))
      });
    }

    // Return top results with semantic scoring
    
    const topRanked = ranked.slice(0, 3);
    
    // 🛡️ QUALITY GUARD: Verify and calibrate before returning results
    // Context tracking and verification removed
    
    return res.status(200).json({
      success: true,
      found: false,
      multipleResults: true,
      query: message,
      message: '✨ พบ 3 คำถามที่ใกล้เคียง\n(ลองเลือกซักอันดูสิ 😊)',
      // 🆕 Include officer contacts relevant to the returned suggestions
      // Fetch officers ONLY for the top 3 suggestions by their QuestionsAnswersID
      ...(await (async () => {
        try {
          // Extract QuestionsAnswersIDs from top 3 suggestions
          const qaIds = topRanked
            .map(r => r && r.item && r.item.QuestionsAnswersID)
            .filter(id => !!id);
          
          if (!qaIds || qaIds.length === 0) {
            return { contacts: [] };
          }
          
          // Fetch officers WHERE OfficerID matches the OfficerID in those QuestionsAnswers records
          const [rows] = await connection.query(
            `SELECT DISTINCT o.OfficerID, o.OfficerName AS officer, o.OfficerPhone AS phone, org.OrgName AS organization
             FROM Officers o
             LEFT JOIN Organizations org ON o.OrgID = org.OrgID
             INNER JOIN QuestionsAnswers qa ON qa.OfficerID = o.OfficerID
             WHERE qa.QuestionsAnswersID IN (?) AND o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
             ORDER BY org.OrgName ASC`,
            [qaIds]
          );
          
          if (!rows || rows.length === 0) {
            return { contacts: [] };
          }
          
          const { formatThaiPhone } = require('../../utils/formatPhone');
          const contacts = (rows || []).map(r => ({
            organization: r.organization || null,
            officer: r.officer || null,
            phone: r.phone || null,
            officerPhoneRaw: r.phone || null,
            officerPhone: r.phone ? formatThaiPhone(r.phone) : null
          }));
          
          // Deduplicate by officer+phone
          const dedup = [];
          const seen = new Set();
          for (const c of contacts) {
            const key = `${c.officer || ''}::${c.phone || ''}`;
            if (!seen.has(key)) { seen.add(key); dedup.push(c); }
          }
          
          return { contacts: dedup };
        } catch (e) {
          console.warn('Failed to load officer contacts for suggestions:', e && (e.message || e));
          return { contacts: [] };
        }
      })()),
      alternatives: topRanked.map(r => ({
        id: r.item.QuestionsAnswersID,
        title: r.item.QuestionTitle,
        preview: (r.item.QuestionText || '').slice(0, 200),
        text: r.item.QuestionText,
        score: r.score.toFixed(2),
        semanticScore: (r.components.semanticKw + r.components.semanticText + r.components.semanticTitle).toFixed(2),
        keywords: r.item.keywords,
        categories: r.item.CategoriesID || null,
        categoriesPDF: r.item.CategoriesPDF || null,
        finalRanking: rankingById.get(r.item.QuestionsAnswersID) || null
      }))
    });
  } catch (err) {
    console.error('chat/respond error:', err && (err.message || err));
    res.status(500).json({ success: false, message: '😭 อุ๊ะ มีปัญหาเล็กน้อยเกิดขึ้น ลองใหม่ดูนะ' });
  } finally {
    if (connection) connection.release();
  }
};
