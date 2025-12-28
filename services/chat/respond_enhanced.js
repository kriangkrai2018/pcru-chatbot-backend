// ✨ Enhanced respond.js with Word Embedding-like scoring
// เพิ่มการให้คะแนนตามความหมายที่ใกล้เคียง (Semantic Similarity)

const { getStopwordsSet } = require('../stopwords/loadStopwords');

// 📝 Synonym/Similar word mapping (คำพ้องความหมาย)
// ในอนาคตสามารถดึงจาก ML Model หรือ Database
const SEMANTIC_SIMILARITY = {
  'หอใน': { 'หอพัก': 0.95, 'หอ': 0.90, 'ที่พัก': 0.85 },
  'หอพัก': { 'หอใน': 0.95, 'ที่พัก': 0.90, 'หอ': 0.85 },
  'เทอม': { 'ภาคเรียน': 0.95, 'ภาค': 0.80, 'semester': 0.90 },
  'ภาคเรียน': { 'เทอม': 0.95, 'ภาค': 0.85, 'semester': 0.90 },
  'สมัคร': { 'ลงทะเบียน': 0.90, 'apply': 0.85, 'ยื่น': 0.80 },
  'ลงทะเบียน': { 'สมัคร': 0.90, 'register': 0.85, 'ยื่น': 0.75 },
  'ทุน': { 'ทุนการศึกษา': 0.95, 'scholarship': 0.90, 'เงินช่วยเหลือ': 0.80 },
  'ค่า': { 'ค่าใช้จ่าย': 0.90, 'ราคา': 0.85, 'เงิน': 0.80, 'ต้นทุน': 0.75 },
  'เกรด': { 'GPA': 0.95, 'คะแนน': 0.85, 'ผลการเรียน': 0.80 },
  'GPA': { 'เกรด': 0.95, 'เกรดเฉลี่ย': 0.90, 'คะแนนเฉลี่ย': 0.85 }
};

/**
 * Calculate semantic similarity score between two words
 * @param {string} word1 
 * @param {string} word2 
 * @returns {number} similarity score (0-1)
 */
function getSemanticSimilarity(word1, word2) {
  // Exact match
  if (word1 === word2) return 1.0;
  
  // Check synonym dictionary
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

async function normalize(text, pool) {
  const t = String(text || '').toLowerCase().trim();
  const cleaned = t.replace(/[\p{P}\p{S}]/gu, ' ');
  // Ensure separation between letters and numbers so tokens like "มี2.00" -> ["มี", "2", "00"]
  const separated = cleaned.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
  const rawTokens = separated.split(/\s+/).filter(Boolean);
  
  const stopwords = await getStopwordsSet(pool);
  const tokens = rawTokens.filter(tok => !stopwords.has(tok));
  return tokens;
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

async function fetchQAWithKeywords(connection) {
  const [rows] = await connection.query(
    \`SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.ReviewDate, qa.QuestionText, qa.OfficerID,
            c.CategoriesName AS CategoriesID, c.CategoriesPDF
     FROM QuestionsAnswers qa
     LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID\`
  );

  const result = [];
  for (const row of rows) {
    const [keywords] = await connection.query(
      \`SELECT k.KeywordText
       FROM Keywords k
       INNER JOIN AnswersKeywords ak ON k.KeywordID = ak.KeywordID
       WHERE ak.QuestionsAnswersID = ?\`,
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
  const message = req.body?.message || req.body?.text || '';
  const questionId = req.body?.id;

  // Direct answer by ID
  if (questionId) {
    let connection;
    try {
      connection = await pool.getConnection();
      const [rows] = await connection.query(
        \`SELECT qa.QuestionsAnswersID, qa.QuestionTitle, qa.QuestionText, qa.ReviewDate, qa.OfficerID,
                c.CategoriesName AS CategoriesID, c.CategoriesPDF
         FROM QuestionsAnswers qa
         LEFT JOIN Categories c ON qa.CategoriesID = c.CategoriesID
         WHERE qa.QuestionsAnswersID = ?\`,
        [questionId]
      );
      
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, message: 'ไม่พบคำถามที่ระบุ' });
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
      return res.status(500).json({ success: false, message: 'Internal Server Error' });
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
    // Helper: split phone text into multiple phone entries
    const parsePhones = (raw) => {
      if (!raw) return [];
      return String(raw).split(/(?:หรือ|,|;|\/|\||\n)/i).map(p => p.trim()).filter(Boolean);
    };
    const queryTokens = await normalize(message, pool);

    const qaList = await fetchQAWithKeywords(connection);
    if (!qaList || qaList.length === 0) {
      return res.status(200).json({
        success: true,
        found: false,
        message: 'ยังไม่มีข้อมูลคำถาม-คำตอบในระบบ',
        results: []
      });
    }

    const ranked = await rankCandidates(queryTokens, qaList, pool);
    const best = ranked[0];

    const norm = (s) => String(s || '').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').trim();
    const isTitleExact = best && norm(best.item.QuestionTitle) === norm(message);
    const hasAnyOverlap = best && best.components && (best.components.overlap > 0 || best.components.title > 0 || best.components.semantic > 0);

    // Keyword matching with semantic awareness
    let keywordMatches = [];
    if (queryTokens.length > 0) {
      console.log(\`🔍 Query tokens (after stopword removal): [\${queryTokens.join(', ')}]\`);
      console.log(\`📊 Total QA items in database: \${qaList.length}\`);
      
      // Semantic-aware keyword matching
      keywordMatches = qaList.filter(item => {
        return queryTokens.some(qToken => {
          return (item.keywords || []).some(kw => {
            const kwLower = kw.toLowerCase();
            const similarity = getSemanticSimilarity(qToken, kwLower);
            return similarity >= 0.7; // Threshold for semantic match
          });
        });
      });
      
      console.log(\`✅ Semantic keyword match: Found \${keywordMatches.length} items\`);
      if (keywordMatches.length > 0) {
        // Sort by semantic score
        const sortedMatches = keywordMatches.map(item => {
          const kwTokens = item.keywords.map(k => k.toLowerCase());
          const semanticScore = semanticOverlapScore(queryTokens, kwTokens);
          return { item, semanticScore };
        }).sort((a, b) => b.semanticScore - a.semanticScore);
        
        return res.status(200).json({
          success: true,
          found: true,
          multipleResults: true,
          query: message,
          message: 'พบคำถามที่ตรงกับคีย์เวิร์ด กรุณาเลือกคำถามที่ต้องการ',
          alternatives: sortedMatches.map(({ item, semanticScore }) => ({
            id: item.QuestionsAnswersID,
            title: item.QuestionTitle,
            preview: (item.QuestionText || '').slice(0, 200),
            keywords: item.keywords,
            categories: item.CategoriesID || null,
            categoriesPDF: item.CategoriesPDF || null,
            semanticScore: semanticScore.toFixed(2)
          }))
        });
      }
    }

    // No match fallback with contacts
    if (!best || (!isTitleExact && !hasAnyOverlap)) {
      const noKeywordMatches = !keywordMatches || keywordMatches.length === 0;
      if (noKeywordMatches) {
        // Get default contact from config/DB (do NOT hardcode)
        const { getDefaultContact } = require('../../utils/getDefaultContact_fixed');
        const defaultContact = await getDefaultContact(connection);
        try {
          const [contactsRows] = await connection.query(
            \`SELECT DISTINCT org.OrgName AS organization, o.OfficerName AS officer, o.OfficerPhone AS phone
             FROM Officers o
             LEFT JOIN Organizations org ON o.OrgID = org.OrgID
             WHERE o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
               AND (o.OfficerStatus = 1)
             ORDER BY org.OrgName ASC
             LIMIT 50\`
          );

          const { formatThaiPhone } = require('../../utils/formatPhone');
          let contacts = (contactsRows || []).map(r => ({
            organization: r.organization || null,
            officer: r.officer || null,
            phone: r.phone || null,
            officerPhoneRaw: r.phone || null,
            officerPhone: r.phone ? formatThaiPhone(r.phone) : null
          }));
          // Prefer 'วิพาด' name or 081 phone
          const findPreferred = (list) => {
            if (!list) return null;
            const nameMatch = list.find(c => /วิพาด/.test(String(c.officer || '')));
            if (nameMatch) return nameMatch;
            const phoneMatch = list.find(c => (c.phone || '').replace(/\D/g,'').startsWith('081'));
            if (phoneMatch) return phoneMatch;
            return null;
          };
          const preferred = findPreferred(contacts);
          if (preferred) { contacts = [preferred]; console.log('Selected preferred contact (enhanced):', preferred); }
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
                console.log('Using DB default contact for fallback (enhanced):', r);
                contacts = [{
                  organization: r.organization || defaultContact.organization,
                  officer: r.officer || defaultContact.officer,
                  phone: r.phone || defaultContact.phone,
                  officerPhoneRaw: r.phone || defaultContact.officerPhoneRaw,
                  officerPhone: r.phone ? formatThaiPhone(r.phone) : defaultContact.officerPhone
                }];
              } else {
                console.log('No DB contact found for default (enhanced); using static default');
                contacts = [defaultContact];
              }
            } catch (e) {
              console.error('Error fetching default contact from DB', e && (e.message || e));
              contacts = [defaultContact];
            }
          }

          // Prefer to return organizations list (names only) for no-answer fallback
          try {
            // Try find related officers by searching Q&A text first
            const searchText = `%${connection.escape(message).slice(1,-1)}%`;
            const [relatedOfficers] = await connection.query(
              `SELECT DISTINCT o.OfficerName AS name, o.OfficerPhone AS phone, o.OfficerEmail AS email, org.OrgName AS organization
               FROM QuestionsAnswers qa
               JOIN Officers o ON qa.OfficerID = o.OfficerID
               LEFT JOIN Organizations org ON o.OrgID = org.OrgID
               WHERE (qa.QuestionTitle LIKE ? OR qa.QuestionText LIKE ?)
                 AND o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
               ORDER BY qa.QuestionsAnswersID DESC
               LIMIT 3`,
              [searchText, searchText]
            );

            let contacts;
            if (relatedOfficers && relatedOfficers.length > 0) {
              contacts = (relatedOfficers || []).map(r => ({ name: r.name, phones: parsePhones(r.phone), phoneRaw: r.phone, email: r.email, organization: r.organization })).filter(c => (c.name && c.name.trim()) || (c.organization && c.organization.trim()));
            } else {
              // No related officers found - return an empty contacts array so UI shows only the concise help prompt
              contacts = [];
            }
            return res.status(200).json({
              success: true,
              found: false,
              message: 'หากต้องการความช่วยเหลือ โปรดติดต่อเจ้าหน้าที่ด้านล่าง',
              contacts
            });
          } catch (orgErr) {
            console.error('Error fetching organizations for fallback (enhanced):', orgErr && orgErr.message);
            return res.status(200).json({ success: true, found: false, message: 'หากต้องการความช่วยเหลือ โปรดติดต่อเจ้าหน้าที่ด้านล่าง', contacts: [] });
          }
        } catch (cErr) {
          console.error('Error fetching officer contacts:', cErr && cErr.message);
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
              console.error('Error fetching QA officers for fallback (enhanced):', e && e.message);
            }
          }
          return res.status(200).json({
            success: true,
            found: false,
            message: 'หากต้องการความช่วยเหลือ โปรดติดต่อเจ้าหน้าที่ด้านล่าง',
            contacts: fallbackContacts
          });
        }
      }

      // Include fallback contacts in the same card as the ranked results
      const { getDefaultContact } = require('../../utils/getDefaultContact');
      const defaultContact = await getDefaultContact(connection).catch(() => null);
      let contactsForCard = [];
      try {
        const [contactsRows] = await connection.query(
          `SELECT DISTINCT org.OrgName AS organization, o.OfficerName AS officer, o.OfficerPhone AS phone
           FROM Officers o
           LEFT JOIN Organizations org ON o.OrgID = org.OrgID
           WHERE o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> ''
             AND (o.OfficerStatus = 1)
           ORDER BY org.OrgName ASC
           LIMIT 50`
        );
        const { formatThaiPhone } = require('../../utils/formatPhone');
        const mapped = (contactsRows || []).map(r => ({
          organization: r.organization || null,
          officer: r.officer || null,
          phone: r.phone || null,
          officerPhoneRaw: r.phone || null,
          officerPhone: r.phone ? formatThaiPhone(r.phone) : null
        }));
        const findPreferred = (list) => {
          if (!list) return null;
          const nameMatch = list.find(c => /วิพาด/.test(String(c.officer || '')));
          if (nameMatch) return nameMatch;
          const phoneMatch = list.find(c => (c.phone || '').replace(/\D/g,'').startsWith('081'));
          if (phoneMatch) return phoneMatch;
          return null;
        };
        const preferred = findPreferred(mapped);
        if (preferred) contactsForCard = [preferred];
        else if (mapped.length > 0) contactsForCard = [mapped[0]];
        else if (defaultContact) contactsForCard = Array.isArray(defaultContact) ? defaultContact : [defaultContact];
      } catch (e) {
        contactsForCard = defaultContact ? (Array.isArray(defaultContact) ? defaultContact : [defaultContact]) : [];
      }

      return res.status(200).json({
        success: true,
        found: false,
        message: 'ขออภัย ระบบไม่พบคำตอบที่ตรงกับคำถามนี้',
        results: ranked.slice(0, 3).map(r => ({
          id: r.item.QuestionsAnswersID,
          title: r.item.QuestionTitle,
          preview: (r.item.QuestionText || '').slice(0, 200),
          score: r.score.toFixed(2),
        })),
        contacts: contactsForCard
      });
    }

    // Return top results with semantic scoring
    return res.status(200).json({
      success: true,
      found: true,
      multipleResults: true,
      query: message,
      message: 'พบหลายคำถามที่เกี่ยวข้อง กรุณาเลือกคำถามที่ต้องการ',
      alternatives: ranked.slice(0, 10).map(r => ({
        id: r.item.QuestionsAnswersID,
        title: r.item.QuestionTitle,
        preview: (r.item.QuestionText || '').slice(0, 200),
        score: r.score.toFixed(2),
        semanticScore: (r.components.semanticKw + r.components.semanticText + r.components.semanticTitle).toFixed(2)
      }))
    });
  } catch (err) {
    console.error('chat/respond error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    if (connection) connection.release();
  }
};
