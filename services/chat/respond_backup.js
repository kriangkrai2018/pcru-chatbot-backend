// ✅ ระบบปัจจุบันมีอยู่แล้ว (70%):
// ✓ Tokenization
// ✓ Stop Word Removal
// ✓ Keyword Matching
// ✓ Basic Scoring (Jaccard + Overlap)

// ❌ สิ่งที่ขาดตาม Modal (30%):
// ✗ Word Embedding Scoring - คำพ้องความหมาย (หอใน ≈ หอพัก = 0.95)
// ✗ Semantic Similarity - ความคล้ายเชิงความหมาย
// ✗ Contextual Understanding - พิจารณาบริบทรวม

// services/chat/respond.js
// Minimal retrieval + matching service with preprocessing and ranking.

const { getStopwordsSet } = require('../stopwords/loadStopwords');

//    ##Tokenization (การตัดคำ) & Stop Word Removal (การกรองคำ)
async function normalize(text, pool) {
  const t = String(text || '').toLowerCase().trim();
  // remove punctuation
  const cleaned = t.replace(/[\p{P}\p{S}]/gu, ' ');
  // Separate letters and numbers so tokens like "มี2.00" become ["มี", "2", "00"]
  const separated = cleaned.replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2');
  // split by whitespace; Thai segmentation is complex, keep simple tokenization here
  const rawTokens = separated.split(/\s+/).filter(Boolean);
  
  // Get stopwords from database
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
 * Fetch QuestionsAnswers with keywords
 */
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
 * Rank QA candidates by combined score: keyword overlap + jaccard on question text       ##Scoring/Ranking
 */

async function rankCandidates(queryTokens, candidates, pool) {
  const results = [];
  for (const item of candidates) {
    const kwTokens = await normalize((item.keywords || []).join(' '), pool);
    const qTextTokens = await normalize(item.QuestionText || '', pool);
    const titleTokens = await normalize(item.QuestionTitle || '', pool);
    const scoreOverlap = overlapScore(queryTokens, kwTokens) * 2; // weight keywords higher
    const scoreSemantic = jaccardSimilarity(queryTokens, qTextTokens);
    const scoreTitle = jaccardSimilarity(queryTokens, titleTokens) * 2; // boost title similarity
    const total = scoreOverlap + scoreSemantic + scoreTitle;
    results.push({ item, score: total, components: { overlap: scoreOverlap, semantic: scoreSemantic, title: scoreTitle } });
  }
  return results.sort((a, b) => b.score - a.score);
}

module.exports = (pool) => async (req, res) => {
  const message = req.body?.message || req.body?.text || '';
  const questionId = req.body?.id;

  // If ID is provided, fetch and return that specific answer directly
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

    // Strong match if title equals message (normalized)
    const norm = (s) => String(s || '').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').trim();
    const isTitleExact = best && norm(best.item.QuestionTitle) === norm(message);
    const hasAnyOverlap = best && best.components && (best.components.overlap > 0 || best.components.title > 0 || best.components.semantic > 0);

    // Step 1: Use normalized tokens (with stopwords removed) for keyword matching
    // Always prioritize keyword matching over title matching                             ##✓ Keyword Matching (การจับคู่คำสำคัญ)
    let keywordMatches = [];
    if (queryTokens.length > 0) {
      console.log(`🔍 Query tokens (after stopword removal): [${queryTokens.join(', ')}]`);
      console.log(`📊 Total QA items in database: ${qaList.length}`);
      
      // First try: Match ALL query tokens (after stopword removal) in keywords
      keywordMatches = qaList.filter(item =>
        queryTokens.every(token =>
          (item.keywords || []).some(kw => kw.toLowerCase().includes(token))
        )
      );
      
      console.log(`✅ First try (AND match): Found ${keywordMatches.length} items`);
      if (keywordMatches.length > 0) {
        const top = keywordMatches[0];
        console.log(`🏅 Selecting top match to display first: QA#${top.QuestionsAnswersID}`);
        return res.status(200).json({
          success: true,
          found: true,
          multipleResults: keywordMatches.length > 1,
          query: message,
          message: 'พบคำถามที่ตรงกับคีย์เวิร์ด',
          primary: {
            id: top.QuestionsAnswersID,
            title: top.QuestionTitle,
            text: top.QuestionText,
            keywords: top.keywords,
            categories: top.CategoriesID || null,
            categoriesPDF: top.CategoriesPDF || null
          },
          alternatives: keywordMatches.slice(1).map(item => ({
            id: item.QuestionsAnswersID,
            title: item.QuestionTitle,
            preview: (item.QuestionText || '').slice(0, 200),
            keywords: item.keywords,
            categories: item.CategoriesID || null,
            categoriesPDF: item.CategoriesPDF || null
          }))
        });
      }

      // Second try: Match ANY query token (OR match)
      keywordMatches = qaList.filter(item =>
        (item.keywords || []).some(kw =>
          queryTokens.some(token => kw.toLowerCase().includes(token))
        )
      );
      
      if (keywordMatches.length > 0) {
        const top = keywordMatches[0];
        return res.status(200).json({
          success: true,
          found: true,
          multipleResults: keywordMatches.length > 1,
          query: message,
          message: 'พบหลายคำถามที่เกี่ยวข้องกับคีย์เวิร์ด',
          primary: {
            id: top.QuestionsAnswersID,
            title: top.QuestionTitle,
            text: top.QuestionText,
            keywords: top.keywords,
            categories: top.CategoriesID || null,
            categoriesPDF: top.CategoriesPDF || null
          },
          alternatives: keywordMatches.slice(1).map(item => ({
            id: item.QuestionsAnswersID,
            title: item.QuestionTitle,
            preview: (item.QuestionText || '').slice(0, 200),
            keywords: item.keywords,
            categories: item.CategoriesID || null,
            categoriesPDF: item.CategoriesPDF || null
          }))
        });
      }

      // Third try: Reverse match (token contains keyword)
      keywordMatches = qaList.filter(item =>
        (item.keywords || []).some(kw =>
          queryTokens.some(token => token.includes(kw.toLowerCase()))
        )
      );
      
      if (keywordMatches.length > 0) {
        const top = keywordMatches[0];
        return res.status(200).json({
          success: true,
          found: true,
          multipleResults: keywordMatches.length > 1,
          query: message,
          message: 'พบหลายคำถามที่เกี่ยวข้องกับคีย์เวิร์ด',
          primary: {
            id: top.QuestionsAnswersID,
            title: top.QuestionTitle,
            text: top.QuestionText,
            keywords: top.keywords,
            categories: top.CategoriesID || null,
            categoriesPDF: top.CategoriesPDF || null
          },
          alternatives: keywordMatches.slice(1).map(item => ({
            id: item.QuestionsAnswersID,
            title: item.QuestionTitle,
            preview: (item.QuestionText || '').slice(0, 200),
            keywords: item.keywords,
            categories: item.CategoriesID || null,
            categoriesPDF: item.CategoriesPDF || null
          }))
        });
      }
    }

    // thresholding: only no-match when no overlap at all
    if (!best || (!isTitleExact && !hasAnyOverlap)) {
      const noKeywordMatches = !keywordMatches || keywordMatches.length === 0;
      if (noKeywordMatches) {
        // Get default contact from config/DB (do NOT hardcode)
        const { getDefaultContact } = require('../../utils/getDefaultContact_fixed');
        const defaultContact = await getDefaultContact(connection);

        // Formal apology message when nothing at all matches
        // Also include a list of contact numbers from Officers table to help user
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
          if (preferred) { contacts = [preferred]; console.log('Selected preferred contact (backup):', preferred); }

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
                console.log('Using DB default contact for fallback (backup):', r);
                contacts = [{
                  organization: r.organization || defaultContact.organization,
                  officer: r.officer || defaultContact.officer,
                  phone: r.phone || defaultContact.phone,
                  officerPhoneRaw: r.phone || defaultContact.officerPhoneRaw,
                  officerPhone: r.phone ? formatThaiPhone(r.phone) : defaultContact.officerPhone
                }];
              } else {
                console.log('No DB contact found for default (backup); using static default');
                contacts = [defaultContact];
              }
            } catch (e) {
              console.error('Error fetching default contact from DB', e && (e.message || e));
              contacts = [defaultContact];
            }
          }

          // Prefer to return organizations list (names only) for no-answer fallback (backup)
          try {
            // Do not return a plain list of organization names as inline text;
            // prefer returning concise message and leave organization/contact details to other logic
            const [orgRows] = await connection.query(`SELECT OrgName AS organization FROM Organizations ORDER BY OrgName ASC`);
            const orgContacts = (orgRows || []).map(r => ({ organization: r.organization || r.OrgName || '' })).filter(c => c.organization && c.organization.trim());
            return res.status(200).json({
              success: true,
              found: false,
              message: 'หากต้องการความช่วยเหลือ โปรดติดต่อเจ้าหน้าที่ด้านล่าง',
              contacts: orgContacts
            });
          } catch (orgErr) {
            console.error('Error fetching organizations for fallback (backup):', orgErr && orgErr.message);
            return res.status(200).json({ success: true, found: false, message: 'หากต้องการความช่วยเหลือ โปรดติดต่อเจ้าหน้าที่ด้านล่าง', contacts: [] });
          }
        } catch (cErr) {
          console.error('Error fetching officer contacts for apology response:', cErr && cErr.message);
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
              console.error('Error fetching QA officers for fallback (backup):', e && e.message);
            }
          }
          // Try to return the organizations list first; if that fails, fall back to any available org names from fallbackContacts
          try {
            const [orgRows] = await connection.query(`SELECT OrgName AS organization FROM Organizations ORDER BY OrgName ASC`);
            const orgContacts = (orgRows || []).map(r => ({ organization: r.organization || r.OrgName || '' })).filter(c => c.organization && c.organization.trim());
            if (orgContacts.length > 0) {
              return res.status(200).json({ success: true, found: false, message: 'หากต้องการความช่วยเหลือ โปรดติดต่อเจ้าหน้าที่ด้านล่าง', contacts: orgContacts });
            }
          } catch (orgErr) {
            console.error('Error fetching organizations for fallback (backup catch):', orgErr && orgErr.message);
          }

          const orgsFromFallback = (fallbackContacts || []).map(c => ({ organization: c.organization || c.OrgName || null })).filter(Boolean);
          return res.status(200).json({
            success: true,
            found: false,
            message: 'หากต้องการความช่วยเหลือ โปรดติดต่อเจ้าหน้าที่ด้านล่าง',
            contacts: orgsFromFallback
          });
        }
      }

      // If there were keywordMatches present but no strong overlap, return top suggestions
      return res.status(200).json({
        success: true,
        found: false,
        message: 'ขออภัย ระบบไม่พบคำตอบที่ตรงกับคำถามนี้',
        results: ranked.slice(0, 3).map(r => ({
          id: r.item.QuestionsAnswersID,
          title: r.item.QuestionTitle,
          preview: (r.item.QuestionText || '').slice(0, 200),
          score: r.score,
        }))
      });
    }

    // Always return multiple results to let user choose
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
        score: r.score,
      }))
    });
  } catch (err) {
    console.error('chat/respond error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    if (connection) connection.release();
  }
};
