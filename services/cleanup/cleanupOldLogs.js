/**
 * cleanupOldLogs.js
 * ลบข้อมูล ChatLogHasAnswers, ChatLogNoAnswers, และ Feedbacks ที่เก่ากว่ากำหนด
 * - ChatLogNoAnswers: เก็บ 30 วัน
 * - ChatLogHasAnswers/Feedbacks: ตาม RETENTION_DAYS (default 30 วัน)
 * คำนวณจากวันที่จัดเก็บ (Timestamp/FeedbackDate)
 */

const RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS) || 30;
const NO_ANSWER_RETENTION_DAYS = 30; // ChatLogNoAnswers เก็บแค่ 30 วัน

/**
 * ลบ ChatLogHasAnswers ที่ไม่มี Feedback คู่กัน (orphaned records)
 * ChatLogHasAnswers และ Feedbacks ต้องมีจำนวนเท่ากัน
 * @param {Pool} pool - MySQL connection pool
 * @returns {Promise<number>} - จำนวน records ที่ถูกลบ
 */
async function cleanupOrphanedChatLogs(pool) {
  let connection;
  let deletedCount = 0;
  try {
    connection = await pool.getConnection();
    
    // ลบ ChatLogHasAnswers ที่ไม่มี Feedback คู่กัน
    const [result] = await connection.query(
      `DELETE cl FROM ChatLogHasAnswers cl
       LEFT JOIN Feedbacks f ON cl.ChatLogID = f.ChatLogID
       WHERE f.FeedbackID IS NULL`
    );
    deletedCount = result.affectedRows || 0;
    
    if (deletedCount > 0) {
      console.log(`[cleanup] ✅ Deleted ${deletedCount} orphaned ChatLogHasAnswers (no matching Feedback)`);
    }
  } catch (err) {
    console.error('[cleanup] cleanupOrphanedChatLogs error:', err && err.message);
  } finally {
    if (connection) connection.release();
  }
  
  return deletedCount;
}

/**
 * ลบข้อมูลเก่าจากตาราง ChatLogHasAnswers, ChatLogNoAnswers, Feedbacks
 * @param {Pool} pool - MySQL connection pool
 * @returns {Promise<{hasAnswers: number, noAnswers: number, feedbacks: number, orphaned: number}>}
 */
async function cleanupOldLogs(pool) {
  const results = {
    hasAnswers: 0,
    noAnswers: 0,
    feedbacks: 0,
    orphaned: 0,
  };

  let connection;
  try {
    connection = await pool.getConnection();

    // ลบ ChatLogHasAnswers ที่เก่ากว่า RETENTION_DAYS วัน
    const [hasAnswersResult] = await connection.query(
      `DELETE FROM ChatLogHasAnswers WHERE Timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [RETENTION_DAYS]
    );
    results.hasAnswers = hasAnswersResult.affectedRows || 0;

    // ลบ ChatLogNoAnswers ที่เก่ากว่า 30 วัน (NO_ANSWER_RETENTION_DAYS)
    const [noAnswersResult] = await connection.query(
      `DELETE FROM ChatLogNoAnswers WHERE Timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [NO_ANSWER_RETENTION_DAYS]
    );
    results.noAnswers = noAnswersResult.affectedRows || 0;

    // ลบ Feedbacks ที่เก่ากว่า RETENTION_DAYS วัน
    const [feedbacksResult] = await connection.query(
      `DELETE FROM Feedbacks WHERE FeedbackDate < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [RETENTION_DAYS]
    );
    results.feedbacks = feedbacksResult.affectedRows || 0;

    console.log(
      `[cleanup] Deleted old logs (>${RETENTION_DAYS} days): HasAnswers=${results.hasAnswers}, NoAnswers=${results.noAnswers}, Feedbacks=${results.feedbacks}`
    );
  } catch (err) {
    console.error('[cleanup] cleanupOldLogs error:', err && err.message);
  } finally {
    if (connection) connection.release();
  }

  // หลังจากลบ logs เก่าแล้ว ให้ลบ orphaned ChatLogHasAnswers ที่ไม่มี Feedback ด้วย
  results.orphaned = await cleanupOrphanedChatLogs(pool);

  return results;
}

module.exports = { cleanupOldLogs, cleanupOrphanedChatLogs, RETENTION_DAYS, NO_ANSWER_RETENTION_DAYS };
