/**
 * Manage Negative Keywords Service
 *
 * Provides safer operations for managing negative keywords using the DB
 * - deleteNegativeKeywordSafe(pool, idOrWord)
 *    - removes the negative keyword from active table
 *    - inserts it into NegativeKeywords_Ignored (or uses existing helper)
 *    - ensures in-memory cache is updated (via clearNegativeKeywordsCache)
 *
 * This file intentionally contains no hard-coded word arrays.
 */

const { addIgnoredNegativeKeyword, clearNegativeKeywordsCache } = require('./negativeKeywords/loadNegativeKeywords');

/**
 * Safely delete a negative keyword by id or word and mark it as ignored
 * @param {Pool} pool - MySQL connection pool
 * @param {number|string} idOrWord - NegativeKeywordID (number) or Word (string)
 * @returns {Promise<{ ok: boolean, word: string, id: number|null }>} 
 */
async function deleteNegativeKeywordSafe(pool, idOrWord) {
  if (!pool) throw new Error('Database pool required');
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    let word = null;
    let id = null;

    if (typeof idOrWord === 'number' || (typeof idOrWord === 'string' && /^\d+$/.test(idOrWord))) {
      id = parseInt(idOrWord, 10);
      const [rows] = await conn.query('SELECT NegativeKeywordID, Word FROM NegativeKeywords WHERE NegativeKeywordID = ?', [id]);
      if (!rows || rows.length === 0) {
        await conn.rollback();
        return { ok: false, message: 'ไม่พบคำปฏิเสธที่ต้องการลบ' };
      }
      word = rows[0].Word;
    } else {
      word = String(idOrWord || '').trim();
      if (!word) {
        await conn.rollback();
        return { ok: false, message: 'กรุณาระบุคำที่จะลบ' };
      }
      // Try to find id if present
      const [rows] = await conn.query('SELECT NegativeKeywordID FROM NegativeKeywords WHERE LOWER(Word) = LOWER(?)', [word]);
      if (rows && rows.length > 0) id = rows[0].NegativeKeywordID;
    }

    // Add to ignored table and deactivate in main table (helper does this and updates in-memory map)
    const ignoredOk = await addIgnoredNegativeKeyword(pool, word);

    // Delete from NegativeKeywords by id if available, else by word
    if (id) {
      await conn.query('DELETE FROM NegativeKeywords WHERE NegativeKeywordID = ?', [id]);
    } else {
      await conn.query('DELETE FROM NegativeKeywords WHERE LOWER(Word) = LOWER(?)', [word.toLowerCase()]);
    }

    await conn.commit();

    // Reload/clear cache so scoring logic uses latest data
    try {
      await clearNegativeKeywordsCache(pool);
    } catch (e) {
      // non-fatal
      console.warn('clearNegativeKeywordsCache failed after delete:', e && e.message);
    }

    return { ok: true, word, id: id || null };
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (e) { /* ignore */ }
    }
    console.error('deleteNegativeKeywordSafe failed:', err && err.message);
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  deleteNegativeKeywordSafe
};
