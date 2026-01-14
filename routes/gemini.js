/**
 * Gemini AI Routes
 * API endpoints สำหรับ Gemini AI
 */

const express = require('express');
const router = express.Router();
const geminiService = require('../services/gemini');
const geminiIntegration = require('../services/chat/geminiIntegration');

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
 * Search database for matching answers
 * ค้นหาจากฐานข้อมูล เพื่อใช้เป็น context สำหรับ Gemini
 */
const axios = require('axios');

/**
 * Simple Google search fallback: fetches Google search HTML and extracts first result URL and snippet.
 * Note: scraping Google is brittle but acceptable as a pragmatic fallback. We set a UA header to avoid immediate blocking.
 */
async function googleSearchTopResult(query) {
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=1&hl=th`;
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36'
      },
      timeout: 4000
    });
    const html = resp.data || '';

    // Try to extract the first organic result URL
    const urlMatch = /\/url\?q=([^&\"]+)/i.exec(html);
    const snippetMatch = /<div class="BNeawe s3v9rd AP7Wnd">([\s\S]*?)<\/div>/i.exec(html);

    if (urlMatch) {
      const link = decodeURIComponent(urlMatch[1]);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      return { success: true, link, snippet };
    }

    return { success: false };
  } catch (e) {
    console.warn('⚠️ Google search fallback failed:', e.message);
    return { success: false };
  }
}

// --------------------------
// Location Intent Helpers
// --------------------------
let cachedLocationKeywords = null;
let cachedLocationKeywordsTs = 0;
const LOCATION_KEYWORDS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function escapeRegexText(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Load location keywords from environment or AppSettings DB key 'LOCATION_QUERY_KEYWORDS'.
 * Returns an array of keywords (strings). No hard-coded keywords here.
 */
async function getLocationKeywords(pool) {
  // Use cached if recent
  if (cachedLocationKeywords && (Date.now() - cachedLocationKeywordsTs) < LOCATION_KEYWORDS_CACHE_TTL_MS) {
    return cachedLocationKeywords;
  }

  // 1) ENV var (comma-separated)
  const envList = process.env.LOCATION_QUERY_KEYWORDS;
  if (envList && envList.trim()) {
    const arr = envList.split(',').map(s => s.trim()).filter(Boolean);
    cachedLocationKeywords = arr;
    cachedLocationKeywordsTs = Date.now();
    console.log('📥 Loaded location keywords from ENV:', arr);
    return cachedLocationKeywords;
  }

  // 2) Try reading from AppSettings table (if available)
  if (pool) {
    try {
      const conn = await pool.getConnection();
      try {
        const [rows] = await conn.query("SELECT SettingValue FROM AppSettings WHERE SettingKey = 'LOCATION_QUERY_KEYWORDS' LIMIT 1");
        if (rows && rows.length > 0 && rows[0].SettingValue) {
          let val = rows[0].SettingValue;
          // If it's JSON array, parse, else treat as CSV
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              cachedLocationKeywords = parsed.map(s => String(s).trim()).filter(Boolean);
            }
          } catch (e) {
            cachedLocationKeywords = String(val).split(',').map(s => s.trim()).filter(Boolean);
          }

          if (cachedLocationKeywords.length) {
            cachedLocationKeywordsTs = Date.now();
            console.log('📥 Loaded location keywords from DB AppSettings:', cachedLocationKeywords);
            return cachedLocationKeywords;
          }
        }
      } finally {
        conn.release();
      }
    } catch (e) {
      console.warn('⚠️ Could not read AppSettings for LOCATION_QUERY_KEYWORDS:', e.message);
    }
  }

  // 3) No configured keywords — return empty list (do not hardcode fallback keywords)
  console.warn('⚠️ No location keywords configured (set LOCATION_QUERY_KEYWORDS env or AppSettings entry).');
  cachedLocationKeywords = [];
  cachedLocationKeywordsTs = Date.now();
  return cachedLocationKeywords;
}

/**
 * Determine whether a message is a location/navigation query using configured keywords.
 * Returns boolean.
 */
async function isLocationQueryMessage(message, pool) {
  if (!message || !message.trim()) return false;
  const keywords = await getLocationKeywords(pool);
  if (keywords && keywords.length > 0) {
    const pattern = '\\b(' + keywords.map(escapeRegexText).join('|') + ')\\b';
    const re = new RegExp(pattern, 'i');
    return re.test(message);
  }
  // If no configured keywords, fall back to coordinate or maps-link detection (no hard-coded keyword list)
  if (/\d{1,3}\.\d{4,},\s*\d{1,3}\.\d{4,}/.test(message)) return true; // coordinates present
  if (/maps\.app\.goo\.gl|maps\.google|google\.com\/maps|goo\.gl\/maps/i.test(message)) return true; // maps link
  return false;
}
async function getContextFromDatabase(message, pool) {
  // Helper to extract coordinates from text
  function extractCoordsFromText(text) {
    if (!text) return null;
    // match lat,lng like 16.422083, 101.152533 or embedded in text
    const m = /(-?\d{1,3}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/.exec(text);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      // basic validation for Thailand bounds
      if (lat >= 5 && lat <= 21 && lng >= 97 && lng <= 106) {
        return { lat, lng };
      }
    }
    return null;
  }

  try {
    const connection = await pool.getConnection();
    try {
      console.log(`🔍 Searching database for: "${message}"`);

      // If the message looks like a location/navigation question (driven by configuration), prefer navigation entries first
      const isLocationQuery = await isLocationQueryMessage(message, connection);
      if (isLocationQuery) {
        console.log('🔎 Location query detected (via configured keywords or map/coords) - running navigation-focused search');
        const [navResults] = await connection.query(`
          SELECT QuestionsAnswersID, QuestionTitle, QuestionText
          FROM QuestionsAnswers
          WHERE (QuestionTitle LIKE '%พิกัด%' OR QuestionTitle LIKE '%นำทาง%' OR QuestionTitle LIKE '%ที่ตั้ง%' OR QuestionTitle LIKE '%แผนที่%' OR QuestionTitle LIKE '%ตึก%' OR QuestionTitle LIKE '%อาคาร%')
            AND (
              QuestionText LIKE '%maps.app.goo.gl%'
              OR QuestionText LIKE '%maps.google%'
              OR QuestionText LIKE '%goo.gl/maps%'
              OR QuestionText LIKE '%google.com/maps%'
              OR QuestionText REGEXP '[0-9]+\\.[0-9]+,[[:space:]]*[0-9]+\\.[0-9]+'
            )
          ORDER BY QuestionsAnswersID DESC
          LIMIT 1
        `);

        if (navResults && navResults.length > 0) {
          const r = navResults[0];
          const coords = extractCoordsFromText(r.QuestionText) || extractCoordsFromText(r.QuestionTitle);
          return {
            found: true,
            title: r.QuestionTitle || '',
            answer: r.QuestionText || '',
            keywords: '',
            lat: coords ? coords.lat : null,
            lng: coords ? coords.lng : null
          };
        }
        // If nav search fails, continue to regular strategies below
      }

      // Strategy 1: Search keywords directly (best for Thai content)
      let [results] = await connection.query(`
        SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.QuestionText,
               GROUP_CONCAT(DISTINCT k.KeywordText SEPARATOR ', ') AS keywords,
               COUNT(DISTINCT k.KeywordID) as keywordCount
        FROM QuestionsAnswers qa
        INNER JOIN AnswersKeywords ak ON qa.QuestionsAnswersID = ak.QuestionsAnswersID
        INNER JOIN Keywords k ON ak.KeywordID = k.KeywordID
        WHERE LOWER(k.KeywordText) LIKE LOWER(CONCAT('%', ?, '%'))
        GROUP BY qa.QuestionsAnswersID
        ORDER BY keywordCount DESC
        LIMIT 1
      `, [message]);
      
      if (results && results.length > 0) {
        console.log(`✅ Strategy 1 (keyword match) found: "${results[0].QuestionTitle}"`);
        const topResult = results[0];
        const coords = extractCoordsFromText(topResult.QuestionText) || extractCoordsFromText(topResult.QuestionTitle);
        return {
          found: true,
          title: topResult.QuestionTitle || '',
          answer: topResult.QuestionText || '',
          keywords: topResult.keywords || '',
          lat: coords ? coords.lat : null,
          lng: coords ? coords.lng : null
        };
      }

      // Strategy 2: Try word-by-word search (try each word until we find a match)
      console.log(`⏳ Strategy 1 failed, trying word-by-word...`);
      const words = message.split(/\s+/).filter(w => w.length > 1);
      if (words.length > 0) {
        // Try each word in order of preference (usually the most important word comes first)
        for (const word of words) {
          if (word.toLowerCase() === 'มอ') continue; // Skip particles
          const [wordResults] = await connection.query(`
            SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.QuestionText,
                   GROUP_CONCAT(DISTINCT k.KeywordText SEPARATOR ', ') AS keywords,
                   COUNT(DISTINCT k.KeywordID) as keywordCount
            FROM QuestionsAnswers qa
            INNER JOIN AnswersKeywords ak ON qa.QuestionsAnswersID = ak.QuestionsAnswersID
            INNER JOIN Keywords k ON ak.KeywordID = k.KeywordID
            WHERE LOWER(k.KeywordText) LIKE LOWER(CONCAT('%', ?, '%'))
            GROUP BY qa.QuestionsAnswersID
            ORDER BY keywordCount DESC
            LIMIT 1
          `, [word]);
          
          if (wordResults && wordResults.length > 0) {
            console.log(`✅ Strategy 2 (word "${word}") found: "${wordResults[0].QuestionTitle}"`);
            const topResult = wordResults[0];
            const coords = extractCoordsFromText(topResult.QuestionText) || extractCoordsFromText(topResult.QuestionTitle);
            return {
              found: true,
              title: topResult.QuestionTitle || '',
              answer: topResult.QuestionText || '',
              keywords: topResult.keywords || '',
              lat: coords ? coords.lat : null,
              lng: coords ? coords.lng : null
            };
          }
        }
      }

      // Strategy 3: LIKE on title/text
      console.log(`⏳ Strategy 2 failed, trying title/text LIKE...`);
      [results] = await connection.query(`
        SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.QuestionText,
               GROUP_CONCAT(k.KeywordText SEPARATOR ', ') AS keywords
        FROM QuestionsAnswers qa
        LEFT JOIN AnswersKeywords ak ON qa.QuestionsAnswersID = ak.QuestionsAnswersID
        LEFT JOIN Keywords k ON ak.KeywordID = k.KeywordID
        WHERE LOWER(CONCAT(qa.QuestionTitle, ' ', qa.QuestionText)) LIKE LOWER(CONCAT('%', ?, '%'))
        GROUP BY qa.QuestionsAnswersID
        LIMIT 1
      `, [message]);
      
      if (results && results.length > 0) {
        console.log(`✅ Strategy 3 (title/text) found: "${results[0].QuestionTitle}"`);
        const topResult = results[0];
        const coords = extractCoordsFromText(topResult.QuestionText) || extractCoordsFromText(topResult.QuestionTitle);
        return {
          found: true,
          title: topResult.QuestionTitle || '',
          answer: topResult.QuestionText || '',
          keywords: topResult.keywords || '',
          lat: coords ? coords.lat : null,
          lng: coords ? coords.lng : null
        };
      }

      console.log(`❌ All strategies failed for: "${message}"`);
      return { found: false };
    } finally {
      connection.release();
    }
  } catch (error) {
    console.warn('⚠️ Database search failed:', error.message);
    return { found: false };
  }
}

/**
 * POST /api/gemini/chat
 * ส่งข้อความถึง Gemini AI
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, options } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'กรุณาระบุข้อความ (message)',
      });
    }

    const result = await geminiService.chat(message, options || {});

    if (result.success) {
      return res.json(result);
    } else {
      return res.status(500).json(result);
    }
  } catch (error) {
    console.error('❌ Gemini Chat Route Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/gemini/test
 * ทดสอบการเชื่อมต่อกับ Gemini API
 */
router.get('/test', async (req, res) => {
  try {
    const result = await geminiService.testConnection();
    
    if (result.success) {
      return res.json(result);
    } else {
      return res.status(500).json(result);
    }
  } catch (error) {
    console.error('❌ Gemini Test Route Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/gemini/enhance
 * ปรับปรุงคำตอบด้วย AI (สำหรับใช้ร่วมกับระบบ keyword matching)
 */
router.post('/enhance', async (req, res) => {
  try {
    const { question, baseAnswer, context } = req.body;

    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาระบุคำถาม (question)',
      });
    }

    // สร้าง prompt สำหรับปรับปรุงคำตอบ
    let prompt = '';
    
    if (baseAnswer) {
      prompt = `คำถามจากผู้ใช้: "${question}"

คำตอบพื้นฐานจากระบบ: "${baseAnswer}"

${context ? `บริบทเพิ่มเติม: ${context}` : ''}

กรุณาปรับปรุงคำตอบให้เป็นธรรมชาติและเป็นมิตรมากขึ้น โดยยังคงข้อมูลสำคัญไว้ครบถ้วน ตอบสั้นกระชับ`;
    } else {
      prompt = `คำถามจากผู้ใช้: "${question}"

${context ? `บริบท: ${context}` : ''}

กรุณาตอบคำถามนี้อย่างเป็นมิตรและเป็นประโยชน์ หากไม่แน่ใจในคำตอบ ให้แนะนำให้ติดต่อเจ้าหน้าที่มหาวิทยาลัยโดยตรง`;
    }

    const result = await geminiService.chat(prompt);

    if (result.success) {
      return res.json({
        success: true,
        originalAnswer: baseAnswer || null,
        enhancedAnswer: result.message,
        usage: result.usage,
      });
    } else {
      return res.status(500).json(result);
    }
  } catch (error) {
    console.error('❌ Gemini Enhance Route Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/gemini/conversation
 * สนทนาต่อเนื่องด้วย AI (แบบ conversation history)
 * 🔍 ค้นหาจากฐานข้อมูล เพื่อใช้เป็น context ตอบคำถาม
 */
router.post('/conversation', async (req, res) => {
  try {
    const { message, sessionId, context } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาระบุข้อความ (message)',
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'กรุณาระบุ sessionId',
      });
    }

    // 🔍 Search database for relevant answers
    const dbContext = await getContextFromDatabase(message, req.pool);

    // If DB has a direct answer, return it (prefer DB over free-form AI to avoid hallucination)
    if (dbContext.found) {
      console.log(`✅ Returning DB answer for "${message}" -> ${dbContext.title}`);
      // Try to enhance for readability but keep DB as source of truth
      try {
        const enhanced = await geminiIntegration.enhanceAnswer(message, dbContext.answer, { category: context?.category });
        let finalAnswer = (enhanced && enhanced.success) ? enhanced.answer : dbContext.answer;

        // If DB contains coords, append them to the visible message (so frontend's linkifyText will render a map widget)
        if (dbContext.lat && dbContext.lng) {
          const coordLine = `\n\n📍 พิกัด: ${dbContext.lat}, ${dbContext.lng}`;
          if (!/\d{1,3}\.\d{4,},\s*\d{1,3}\.\d{4,}/.test(finalAnswer)) {
            finalAnswer = finalAnswer + coordLine;
          }
        }

        // Build response payload
        const payload = {
          success: true,
          message: finalAnswer,
          source: 'database',
          databaseTitle: dbContext.title,
          databaseAnswer: dbContext.answer
        };

        // Attach coordinates/map if available
        if (dbContext.lat && dbContext.lng) {
          payload.databaseLat = dbContext.lat;
          payload.databaseLng = dbContext.lng;
          payload.databaseMapUrl = `https://www.google.com/maps?q=${dbContext.lat},${dbContext.lng}&output=embed`;
        }

        // Add contacts
        try {
          const { getDefaultContacts } = require('../utils/getDefaultContact_fixed');
          payload.contacts = await getDefaultContacts(req.pool);
        } catch (e) {
          payload.contacts = [];
        }

        return res.json(payload);
      } catch (e) {
        console.warn('⚠️ Failed to enhance DB answer, returning raw DB answer:', e.message);
        return res.json({
          success: true,
          message: dbContext.answer,
          source: 'database',
          databaseTitle: dbContext.title,
          databaseAnswer: dbContext.answer,
          contacts: []
        });
      }
    }

    // If DB misses, attempt Google fallback
    const googleResult = await googleSearchTopResult(message);
    if (googleResult && googleResult.success) {
      console.log(`🔎 Google fallback found link for "${message}": ${googleResult.link}`);
      const fallbackMsg = `ขอโทษค่ะ ไม่พบคำตอบในฐานข้อมูลของเรา ฉันพบบทความหรือแหล่งข้อมูลที่เกี่ยวข้อง: <a href="${googleResult.link}" target="_blank" rel="noopener noreferrer">ดูที่นี่</a>${googleResult.snippet ? (' — ' + googleResult.snippet) : ''}`;
      let contacts = [];
      try {
        const { getDefaultContacts } = require('../utils/getDefaultContact_fixed');
        contacts = await getDefaultContacts(req.pool);
      } catch (e) {
        console.warn('⚠️ Failed to load contacts:', e.message);
      }
      return res.json({
        success: true,
        message: fallbackMsg,
        source: 'google-fallback',
        googleLink: googleResult.link,
        contacts: contacts || []
      });
    }

    // Else, fall back to conversation via Gemini using database context if any
    let enhancedContext = context || {};
    if (dbContext.found) {
      enhancedContext.databaseAnswer = dbContext.answer;
      enhancedContext.databaseTitle = dbContext.title;
      enhancedContext.databaseScore = dbContext.score;
    }

    const result = await geminiIntegration.continueConversation(
      sessionId,
      message,
      enhancedContext
    );

    if (result.success) {
      // ดึง contacts เพื่อแสดงให้ผู้ใช้
      let contacts = [];
      try {
        const { getDefaultContacts } = require('../utils/getDefaultContact_fixed');
        contacts = await getDefaultContacts(req.pool);
      } catch (e) {
        console.warn('⚠️ Failed to load contacts:', e.message);
      }
      
      return res.json({
        ...result,
        contacts: contacts || []
      });
    } else {
      return res.status(500).json(result);
    }
  } catch (error) {
    console.error('❌ Gemini Conversation Route Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/gemini/conversation/:sessionId
 * ลบประวัติสนทนา
 */
router.delete('/conversation/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = geminiIntegration.clearConversation(sessionId);
    return res.json(result);
  } catch (error) {
    console.error('❌ Clear Conversation Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/gemini/autocomplete
 * ใช้ Gemini AI เติมคำแนะนำอัตโนมัติ
 */
router.post('/autocomplete', async (req, res) => {
  try {
    const { text, limit = 1 } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length < 2) {
      return res.json({
        success: true,
        suggestion: '',
      });
    }

    const userText = text.trim();
    
    // Load quick suggestions from env (ไม่ hardcode)
    let quickSuggestions = {};
    try {
      const suggestionsJson = process.env.AUTOCOMPLETE_QUICK_SUGGESTIONS;
      if (suggestionsJson) {
        quickSuggestions = JSON.parse(suggestionsJson);
      }
    } catch (e) {
      console.warn('⚠️ Failed to parse AUTOCOMPLETE_QUICK_SUGGESTIONS from .env');
    }

    // Check for quick match (fast path)
    for (const [key, value] of Object.entries(quickSuggestions)) {
      if (userText.toLowerCase().startsWith(key.toLowerCase())) {
        return res.json({
          success: true,
          suggestion: value,
        });
      }
    }

    // Fallback to Gemini for other queries
    const maxTokens = parseInt(process.env.AUTOCOMPLETE_MAX_TOKENS) || 1;
    const backendTimeout = parseInt(process.env.AUTOCOMPLETE_BACKEND_TIMEOUT_MS) || 1500;
    
    const prompt = `เติมคำถัดไป (เพียง 1 คำเท่านั้น):
"${userText}"

ตอบเฉพาะคำที่เติม ห้ามตอบเป็นประโยค`;

    const result = await geminiService.chat(prompt, { maxTokens, timeout: backendTimeout });

    if (result.success && result.message) {
      // Clean up the response
      let addition = result.message.trim()
        .split('\n')[0] // Take only the first line
        .split(' ')[0] // Take only first word
        .replace(/^["'"]|["'"]$/g, '')
        .replace(/^เติม:?\s*/i, '')
        .replace(/^ส่วนที่เติม:?\s*/i, '')
        .replace(/[.!?,;:]$/g, '') // Remove trailing punctuation
        .trim();
      
      // Combine user text with addition
      let suggestion = userText + addition;
      
      // Limit total length to ~20 characters (fit in one line)
      if (suggestion.length > 20) {
        suggestion = suggestion.slice(0, 20);
      }

      return res.json({
        success: true,
        suggestion,
      });
    } else {
      return res.json({
        success: true,
        suggestion: '',
      });
    }
  } catch (error) {
    console.error('❌ Gemini Autocomplete Error:', error);
    return res.json({
      success: true,
      suggestion: '',
    });
  }
});

module.exports = router;
