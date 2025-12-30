/**
 * Negative Keywords Service - Look Backward Algorithm
 * 
 * ดักจับประโยคปฏิเสธ เช่น "ไม่เอาหอใน" → พบ "ไม่" ก่อน "หอใน" → ปรับคะแนน
 * 
 * Algorithm:
 * 1. Tokenize query: ['ฉัน', 'ไม่', 'อยาก', 'ได้', 'หอใน']
 * 2. Find keyword 'หอใน' at index 4
 * 3. Look backward 1-2 positions for negative words
 * 4. Found 'ไม่' at index 1 → Apply modifier: score * -1.0 = negative score
 */

// In-memory cache of negative keywords
let NEGATIVE_KEYWORDS_MAP = {}; // word -> weightModifier
const BOT_PRONOUN = process.env.BOT_PRONOUN || 'หนู';

// How many tokens to look backward for negative words
const LOOK_BACKWARD_WINDOW = 3; // Check up to 3 tokens before the keyword

// 🆕 Built-in inline negation patterns (fallback for words not in database)
// These are checked for inline detection even if not in NegativeKeywords table
const INLINE_NEGATION_PATTERNS = [
  { word: 'ไม่เอา', modifier: -1.0 },
  { word: 'ไม่ต้อง', modifier: -1.0 },
  { word: 'ไม่อยาก', modifier: -1.0 },
  { word: 'ไม่ต้องการ', modifier: -1.0 },
  { word: 'ไม่สนใจ', modifier: -1.0 },
  { word: 'ไม่', modifier: -1.0 },
];

/**
 * Load negative keywords from database into memory cache
 * @param {Pool} pool - MySQL connection pool
 */
async function loadNegativeKeywords(pool) {
  let connection;
  try {
    connection = await pool.getConnection();

    const [rows] = await connection.query(`
      SELECT Word, WeightModifier 
      FROM NegativeKeywords 
      WHERE IsActive = 1
    `);

    NEGATIVE_KEYWORDS_MAP = {};
    for (const row of rows) {
      const word = String(row.Word || '').toLowerCase().trim();
      if (word) {
        NEGATIVE_KEYWORDS_MAP[word] = parseFloat(row.WeightModifier) || -1.0;
      }
    }

    // Load ignored set and remove any ignored words from active map
    const ignoredSet = await loadIgnoredNegativeKeywords(pool);
    if (ignoredSet.size > 0) {
      for (const ig of ignoredSet) {
        if (NEGATIVE_KEYWORDS_MAP.hasOwnProperty(ig)) {
          delete NEGATIVE_KEYWORDS_MAP[ig];
        }
      }
    }

    // Auto-populate standard inline patterns (but skip ignored words)
    // Sort patterns by length desc to give precedence to longer phrases
    const standardized = [...INLINE_NEGATION_PATTERNS].sort((a, b) => b.word.length - a.word.length);

    for (const pattern of standardized) {
      const w = String(pattern.word || '').toLowerCase().trim();
      if (!w) continue;
      if (ignoredSet.has(w)) continue; // user explicitly ignored this word
      if (!NEGATIVE_KEYWORDS_MAP.hasOwnProperty(w)) {
        try {
          await connection.query(`INSERT INTO NegativeKeywords (Word, WeightModifier, IsActive) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE WeightModifier = VALUES(WeightModifier), IsActive = 1`, [w, parseFloat(pattern.modifier) || -1.0]);
          NEGATIVE_KEYWORDS_MAP[w] = parseFloat(pattern.modifier) || -1.0;
          console.log(`➕ Auto-added standard negative keyword: "${w}"`);
        } catch (err) {
          // non-fatal, skip
          console.warn(`Auto-insert failed for negative word "${w}":`, err && err.message);
        }
      }
    }

    console.log(`✅ Loaded ${Object.keys(NEGATIVE_KEYWORDS_MAP).length} negative keywords (ignored: ${ignoredSet.size})`);
    return NEGATIVE_KEYWORDS_MAP;
  } catch (error) {
    console.error('❌ Error loading negative keywords:', error && (error.message || error));
    NEGATIVE_KEYWORDS_MAP = {};
    return {};
  } finally {
    if (connection) connection.release();
  }
}

/**
 * Get the negative keywords map (for external use)
 * @returns {Object} word -> weightModifier mapping
 */
function getNegativeKeywordsMap() {
  return NEGATIVE_KEYWORDS_MAP;
}

/**
 * Check if a word is a negative keyword
 * @param {string} word - The word to check
 * @returns {boolean}
 */
function isNegativeKeyword(word) {
  return NEGATIVE_KEYWORDS_MAP.hasOwnProperty(String(word || '').toLowerCase().trim());
}

/**
 * Get weight modifier for a negative keyword
 * @param {string} word - The negative keyword
 * @returns {number|null} Weight modifier or null if not a negative keyword
 */
function getNegativeModifier(word) {
  const key = String(word || '').toLowerCase().trim();
  return NEGATIVE_KEYWORDS_MAP.hasOwnProperty(key) ? NEGATIVE_KEYWORDS_MAP[key] : null;
}

// ------------------------- New: Ignored words helpers -------------------------
async function loadIgnoredNegativeKeywords(pool) {
  try {
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query(`SELECT Word FROM NegativeKeywords_Ignored`);
      const s = new Set((rows || []).map(r => String(r.Word || '').toLowerCase().trim()).filter(Boolean));
      return s;
    } finally {
      conn.release();
    }
  } catch (err) {
    // If the table doesn't exist yet or query fails, return empty set
    return new Set();
  }
}

async function addIgnoredNegativeKeyword(pool, word) {
  try {
    const w = String(word || '').toLowerCase().trim();
    if (!w) return false;
    const conn = await pool.getConnection();
    try {
      await conn.query(`INSERT IGNORE INTO NegativeKeywords_Ignored (Word) VALUES (?)`, [w]);
      // Also deactivate in main NegativeKeywords table if present
      await conn.query(`UPDATE NegativeKeywords SET IsActive = 0 WHERE LOWER(Word) = LOWER(?)`, [w]);
      // Update in-memory cache
      if (NEGATIVE_KEYWORDS_MAP.hasOwnProperty(w)) delete NEGATIVE_KEYWORDS_MAP[w];
      return true;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.warn('addIgnoredNegativeKeyword failed', err && err.message);
    return false;
  }
}

async function removeIgnoredNegativeKeyword(pool, word) {
  try {
    const w = String(word || '').toLowerCase().trim();
    if (!w) return false;
    const conn = await pool.getConnection();
    try {
      await conn.query(`DELETE FROM NegativeKeywords_Ignored WHERE LOWER(Word) = LOWER(?)`, [w]);
      return true;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.warn('removeIgnoredNegativeKeyword failed', err && err.message);
    return false;
  }
}

/**
 * 🆕 Look Backward Algorithm
 * Check if a keyword is negated by looking at tokens before it
 * 
 * @param {Array<string>} allTokens - All tokens from the original query (before stopword removal)
 * @param {string} keyword - The keyword to check for negation
 * @param {number} keywordIndex - Index of the keyword in allTokens (optional, will search if not provided)
 * @returns {{ isNegated: boolean, negativeWord: string|null, modifier: number }}
 */
function checkNegation(allTokens, keyword, keywordIndex = -1) {
  const result = { isNegated: false, negativeWord: null, modifier: 1.0 };

  if (!Array.isArray(allTokens) || allTokens.length === 0) return result;

  const keywordLower = String(keyword || '').toLowerCase().trim();
  if (!keywordLower) return result;

  // Find keyword index if not provided
  let kwIdx = keywordIndex;
  let tokenContainingKeyword = null;
  if (kwIdx < 0) {
    kwIdx = allTokens.findIndex((t) => {
      const lower = String(t || '').toLowerCase().trim();
      const match = lower.includes(keywordLower) || keywordLower.includes(lower);
      if (match) tokenContainingKeyword = lower;
      return match;
    });
  }

  if (kwIdx < 0) return result; // Keyword not found in tokens

  const kwTokenLower = tokenContainingKeyword || String(allTokens[kwIdx] || '').toLowerCase().trim();

  // Inline negation inside the same token (e.g., "ไม่เอาทุน" contains "ไม่เอา" before "ทุน")
  const keywordPos = kwTokenLower.indexOf(keywordLower);
  if (keywordPos >= 0) {
    const beforeSegment = kwTokenLower.slice(0, keywordPos);
    
    // 🆕 First check built-in inline patterns (longer patterns first for priority)
    // Sort by word length descending to match longest pattern first
    const sortedPatterns = [...INLINE_NEGATION_PATTERNS].sort((a, b) => b.word.length - a.word.length);
    for (const pattern of sortedPatterns) {
      if (beforeSegment.includes(pattern.word)) {
        result.isNegated = true;
        result.negativeWord = pattern.word;
        result.modifier = pattern.modifier;
        console.log(`⛔ Inline negation detected: "${pattern.word}" in "${kwTokenLower}" before keyword "${keywordLower}"`);
        return result; // Inline negation takes precedence
      }
    }
    
    // Then check database-loaded negative keywords
    for (const [negWord, modifier] of Object.entries(NEGATIVE_KEYWORDS_MAP)) {
      if (!negWord) continue;
      if (beforeSegment.includes(negWord)) {
        result.isNegated = true;
        result.negativeWord = negWord;
        result.modifier = modifier;
        return result; // Inline negation takes precedence
      }
    }
  }

  // Look backward within the window
  const startIdx = Math.max(0, kwIdx - LOOK_BACKWARD_WINDOW);
  
  for (let i = kwIdx - 1; i >= startIdx; i--) {
    const token = String(allTokens[i] || '').toLowerCase().trim();
    const modifier = getNegativeModifier(token);
    
    if (modifier !== null) {
      result.isNegated = true;
      result.negativeWord = token;
      result.modifier = modifier;
      break; // Use the closest negative word
    }
  }

  return result;
}

/**
 * 🆕 Apply negation penalty to a keyword match score
 * 
 * @param {number} originalScore - The original keyword match score
 * @param {Array<string>} queryTokensOriginal - Original query tokens (before stopword removal)
 * @param {string} matchedKeyword - The keyword that was matched
 * @returns {{ adjustedScore: number, negationInfo: Object|null }}
 */
function applyNegationPenalty(originalScore, queryTokensOriginal, matchedKeyword) {
  const negation = checkNegation(queryTokensOriginal, matchedKeyword);
  
  if (negation.isNegated) {
    const adjustedScore = originalScore * negation.modifier;
    console.log(`⛔ Negation detected: "${negation.negativeWord}" before "${matchedKeyword}" - Score: ${originalScore.toFixed(3)} → ${adjustedScore.toFixed(3)}`);
    return {
      adjustedScore,
      negationInfo: {
        negativeWord: negation.negativeWord,
        modifier: negation.modifier,
        originalScore,
        adjustedScore
      }
    };
  }
  
  return { adjustedScore: originalScore, negationInfo: null };
}

/**
 * 🆕 Analyze entire query for negative patterns
 * Returns detailed analysis of which keywords are negated
 * 
 * @param {Array<string>} queryTokensOriginal - Original query tokens (before stopword removal)
 * @param {Array<string>} matchedKeywords - List of keywords matched from the query
 * @returns {{ hasNegation: boolean, negatedKeywords: Array, negativeWordsFound: Array }}
 */
function analyzeQueryNegation(queryTokensOriginal, matchedKeywords) {
  const result = {
    hasNegation: false,
    negatedKeywords: [],
    negativeWordsFound: [],
    allNegationsInQuery: []
  };

  if (!Array.isArray(queryTokensOriginal)) return result;

  // First, find all negative words in the query
  for (let i = 0; i < queryTokensOriginal.length; i++) {
    const token = String(queryTokensOriginal[i] || '').toLowerCase().trim();
    if (isNegativeKeyword(token)) {
      result.negativeWordsFound.push({
        word: token,
        index: i,
        modifier: getNegativeModifier(token)
      });
    }
  }

  // Then check each matched keyword for negation
  if (Array.isArray(matchedKeywords)) {
    for (const kw of matchedKeywords) {
      const negation = checkNegation(queryTokensOriginal, kw);
      if (negation.isNegated) {
        result.hasNegation = true;
        result.negatedKeywords.push({
          keyword: kw,
          negativeWord: negation.negativeWord,
          modifier: negation.modifier
        });
      }
    }
  }

  // Also return all tokens and their negation status
  result.allNegationsInQuery = queryTokensOriginal.map((token, idx) => ({
    token,
    index: idx,
    isNegative: isNegativeKeyword(token),
    modifier: getNegativeModifier(token)
  }));

  return result;
}

/**
 * 🆕 Detect Bridge Intent: user negates one domain but wants another
 * Example: "ไม่เอาทุนนะครับ อยากจะดูหอพัก" → negates "ทุน", wants "หอพัก"
 * 
 * @param {Array<string>} queryTokensOriginal - Original tokens from query
 * @param {Object} domainTerms - { scholarship: [...], dorm: [...], admissions: [...] }
 * @returns {{ hasBridgeIntent: boolean, negatedDomains: Array, wantedDomains: Array, bridgeMessage: string|null }}
 */
function detectBridgeIntent(queryTokensOriginal, domainTerms = {}) {
  const result = {
    hasBridgeIntent: false,
    negatedDomains: [],
    wantedDomains: [],
    bridgeMessage: null
  };

  if (!Array.isArray(queryTokensOriginal) || queryTokensOriginal.length === 0) return result;

  const queryLower = queryTokensOriginal.join(' ').toLowerCase();
  const queryJoined = queryTokensOriginal.join('').toLowerCase(); // joined for inline detection

  // Domain name mappings for Thai display
  const domainNamesThai = {
    scholarship: 'ทุน',
    dorm: 'หอพัก',
    admissions: 'รับสมัคร'
  };

  // Check each domain for negation and positive intent
  for (const [domainKey, terms] of Object.entries(domainTerms)) {
    if (!Array.isArray(terms) || terms.length === 0) continue;

    for (const term of terms) {
      const termLower = String(term || '').toLowerCase();
      if (!termLower) continue;

      // Check if this term appears in query
      if (queryLower.includes(termLower) || queryJoined.includes(termLower)) {
        // Check if negated using checkNegation
        const neg = checkNegation(queryTokensOriginal, termLower);
        
        if (neg.isNegated) {
          if (!result.negatedDomains.includes(domainKey)) {
            result.negatedDomains.push(domainKey);
          }
        } else {
          // Not negated = wanted domain
          if (!result.wantedDomains.includes(domainKey)) {
            result.wantedDomains.push(domainKey);
          }
        }
      }
    }
  }

  // Bridge intent = has both negated and wanted domains
  if (result.negatedDomains.length > 0 && result.wantedDomains.length > 0) {
    result.hasBridgeIntent = true;
    
    const negatedNames = result.negatedDomains.map(d => domainNamesThai[d] || d).join(', ');
    const wantedNames = result.wantedDomains.map(d => domainNamesThai[d] || d).join(', ');
    
    // Feminine + friendly tone; pronoun from env
    result.bridgeMessage = `โอเคค่ะ ${BOT_PRONOUN}ข้ามเรื่อง${negatedNames}ไปก่อนนะคะ เดี๋ยว${BOT_PRONOUN}พาไปดู${wantedNames}ที่น่าสนใจให้เลยค่ะ ✨👇`;
  }

  return result;
}

/**
 * Simple tokenizer for original query (without stopword removal)
 * Used for negation detection
 * 
 * @param {string} text - The query text
 * @returns {Array<string>} tokens
 */
function simpleTokenize(text) {
  const t = String(text || '').toLowerCase().trim();
  // Simple split by whitespace and common punctuation
  const tokens = t.split(/[\s,.:;!?()[\]{}'"]+/).filter(Boolean);
  return tokens;
}

/**
 * Clear negative keywords cache and reload from database
 * @param {Pool} pool - MySQL connection pool
 */
async function clearNegativeKeywordsCache(pool) {
  console.log('🗑️ Clearing negative keywords cache...');
  NEGATIVE_KEYWORDS_MAP = {};
  console.log('✅ Cache cleared');
  
  // Reload from database if pool provided
  if (pool) {
    try {
      console.log('📥 Reloading negative keywords from database...');
      await loadNegativeKeywords(pool);
      console.log('✅ Cache reloaded with', Object.keys(NEGATIVE_KEYWORDS_MAP).length, 'keywords');
    } catch (error) {
      console.error('❌ Error reloading negative keywords:', error.message);
    }
  } else {
    console.warn('⚠️ Pool not provided, cache cleared but not reloaded');
  }
}

module.exports = {
  loadNegativeKeywords,
  getNegativeKeywordsMap,
  isNegativeKeyword,
  getNegativeModifier,
  checkNegation,
  applyNegationPenalty,
  analyzeQueryNegation,
  detectBridgeIntent,
  simpleTokenize,
  clearNegativeKeywordsCache,

  // New helpers for ignored negative keywords
  loadIgnoredNegativeKeywords,
  addIgnoredNegativeKeyword,
  removeIgnoredNegativeKeyword,

  LOOK_BACKWARD_WINDOW,
  INLINE_NEGATION_PATTERNS
};
