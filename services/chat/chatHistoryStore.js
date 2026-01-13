/**
 * Chat History Store
 * เก็บประวัติสนทนาของแต่ละผู้ใช้/session
 * 
 * ใช้สำหรับเชื่อมโยง conversation context ใน Gemini AI
 */

// Store chat history per session
// Key: sessionId, Value: array of {role, content}
const chatHistoryStore = new Map();

// Configuration
const MAX_HISTORY_LENGTH = 20; // เก็บ message สูงสุด 20 ข้อความ
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 นาที
const sessionTimestamps = new Map(); // track last activity

/**
 * ตรวจสอบว่า session ยังใช้งานได้หรือไม่
 * ถ้า timeout ให้ลบประวัติ
 */
function validateSession(sessionId) {
  if (!sessionTimestamps.has(sessionId)) {
    return true; // session ใหม่
  }

  const lastActivity = sessionTimestamps.get(sessionId);
  const now = Date.now();
  const elapsed = now - lastActivity;

  if (elapsed > SESSION_TIMEOUT) {
    // Session timeout - ลบประวัติ
    console.log(`⏰ Session ${sessionId.substring(0, 8)}... expired`);
    chatHistoryStore.delete(sessionId);
    sessionTimestamps.delete(sessionId);
    return false;
  }

  return true;
}

/**
 * เพิ่มข้อความลงใน history
 * @param {string} sessionId - Session ID (เช่น user ID หรือ session ID)
 * @param {string} role - 'user' หรือ 'assistant'
 * @param {string} content - เนื้อหาข้อความ
 */
function addMessageToHistory(sessionId, role, content) {
  if (!validateSession(sessionId)) {
    // Session expired, สร้างใหม่
    chatHistoryStore.set(sessionId, []);
  }

  if (!chatHistoryStore.has(sessionId)) {
    chatHistoryStore.set(sessionId, []);
  }

  const history = chatHistoryStore.get(sessionId);

  // เพิ่ม message
  history.push({
    role: role,
    content: content,
  });

  // เก็บแค่ 20 ข้อความล่าสุด (10 round trip)
  if (history.length > MAX_HISTORY_LENGTH) {
    history.shift(); // ลบข้อความแรก
  }

  // อัปเดต timestamp
  sessionTimestamps.set(sessionId, Date.now());

  console.log(`📝 Added message to ${sessionId.substring(0, 8)}... (total: ${history.length})`);
  return history;
}

/**
 * ดึง conversation history
 * @param {string} sessionId - Session ID
 * @returns {Array} - array of {role, content}
 */
function getHistory(sessionId) {
  validateSession(sessionId);

  if (!chatHistoryStore.has(sessionId)) {
    return [];
  }

  return chatHistoryStore.get(sessionId) || [];
}

/**
 * ลบประวัติของ session
 * @param {string} sessionId - Session ID
 */
function clearHistory(sessionId) {
  chatHistoryStore.delete(sessionId);
  sessionTimestamps.delete(sessionId);
  console.log(`🗑️ Cleared history for ${sessionId.substring(0, 8)}...`);
}

/**
 * ลบประวัติ session ที่ expired ทั้งหมด
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, timestamp] of sessionTimestamps.entries()) {
    if (now - timestamp > SESSION_TIMEOUT) {
      chatHistoryStore.delete(sessionId);
      sessionTimestamps.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`🧹 Cleaned up ${cleaned} expired sessions`);
  }
}

/**
 * ดึงสถิติ
 */
function getStats() {
  return {
    totalSessions: chatHistoryStore.size,
    totalMessages: Array.from(chatHistoryStore.values()).reduce(
      (sum, history) => sum + history.length,
      0
    ),
  };
}

// Cleanup expired sessions ทุก 5 นาที
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);

module.exports = {
  addMessageToHistory,
  getHistory,
  clearHistory,
  getStats,
  cleanupExpiredSessions,
};
