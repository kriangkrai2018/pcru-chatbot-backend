/**
 * Gemini AI Integration Module
 * สำหรับ integrate Gemini AI เข้ากับระบบ chat respond ของ PCRU
 * 
 * รองรับ conversation history สำหรับสนทนาต่อเนื่อง
 */

const geminiService = require('../gemini');
const chatHistoryStore = require('./chatHistoryStore');

/**
 * ใช้ Gemini AI ตอบคำถามเมื่อไม่มีคำตอบจากระบบเดิม
 * @param {string} question - คำถามจากผู้ใช้
 * @param {Object} context - บริบทเพิ่มเติม
 * @returns {Promise<string>} - คำตอบจาก AI
 */
async function getAIResponse(question, context = {}) {
  try {
    let prompt = question;

    // ถ้ามีบริบท ให้เพิ่มเข้าไป
    if (context.category) {
      prompt = `คำถาม: ${question}\nหมวดหมู่: ${context.category}\nตอบให้เป็นมิตรและเป็นประโยชน์`;
    }

    const result = await geminiService.chat(prompt);

    if (result.success) {
      return {
        success: true,
        answer: result.message,
        source: 'ai', // บ่งบอกว่าคำตอบมาจาก AI
        model: 'gemini-2.0-flash',
      };
    }

    return {
      success: false,
      error: result.error,
    };
  } catch (error) {
    console.error('❌ Gemini AI Integration Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * ปรับปรุงคำตอบจากระบบเดิม ด้วย AI
 * @param {string} question - คำถามจากผู้ใช้
 * @param {string} baseAnswer - คำตอบเดิมจากระบบ
 * @param {Object} context - บริบทเพิ่มเติม
 * @returns {Promise<string>} - คำตอบที่ปรับปรุง
 */
async function enhanceAnswer(question, baseAnswer, context = {}) {
  try {
    let prompt = `คำถาม: "${question}"

คำตอบเบื้องต้น: "${baseAnswer}"

${context.category ? `หมวดหมู่: ${context.category}` : ''}

ขอให้ปรับปรุงคำตอบให้:
- อ่านง่าย และเป็นธรรมชาติ
- ยังคงข้อมูลสำคัญไว้ครบ
- ตอบสั้นกระชับ (ไม่เกิน 3 ประโยค)
- เป็นมิตรและเป็นประโยชน์`;

    const result = await geminiService.chat(prompt);

    if (result.success) {
      return {
        success: true,
        answer: result.message,
        source: 'ai-enhanced', // บ่งบอกว่าเป็นคำตอบที่ปรับปรุง
        original: baseAnswer,
      };
    }

    return {
      success: false,
      answer: baseAnswer, // ส่งคำตอบเดิมกลับไป
      error: result.error,
    };
  } catch (error) {
    console.error('❌ Gemini Enhance Error:', error);
    return {
      success: false,
      answer: baseAnswer,
      error: error.message,
    };
  }
}

/**
 * ทำให้คำตอบเป็นธรรมชาติขึ้น (สั้นกว่า enhance)
 * @param {string} answer - คำตอบที่ต้องการทำให้ธรรมชาติ
 * @returns {Promise<string>} - คำตอบที่ปรับปรุง
 */
async function refineAnswer(answer) {
  try {
    const prompt = `ให้สรุป และทำให้คำตอบนี้อ่านง่ายและเป็นธรรมชาติขึ้น (ประมาณ 1-2 ประโยค):\n"${answer}"`;

    const result = await geminiService.chat(prompt);

    if (result.success) {
      return result.message;
    }

    return answer; // คืนคำตอบเดิมถ้า error
  } catch (error) {
    console.error('❌ Gemini Refine Error:', error);
    return answer;
  }
}

/**
 * สร้าง Chat Session สำหรับสนทนาต่อเนื่อง
 * @param {string} sessionId - Session ID (user ID หรือ session ID)
 * @param {string} firstMessage - ข้อความแรก
 * @param {Object} context - บริบทเพิ่มเติม
 * @returns {Promise<Object>} - ผลลัพธ์
 */
async function startChatSession(sessionId, firstMessage, context = {}) {
  try {
    // เพิ่มข้อความแรกลง history
    chatHistoryStore.addMessageToHistory(sessionId, 'user', firstMessage);

    // สร้าง prompt ด้วย context
    let prompt = firstMessage;
    if (context.category) {
      prompt = `[หมวดหมู่: ${context.category}]\n${firstMessage}`;
    }

    const result = await geminiService.chat(prompt);

    if (result.success) {
      // เพิ่มคำตอบลง history
      chatHistoryStore.addMessageToHistory(sessionId, 'assistant', result.message);

      return {
        success: true,
        message: result.message,
        sessionId: sessionId,
        history: chatHistoryStore.getHistory(sessionId),
      };
    }

    return {
      success: false,
      error: result.error,
    };
  } catch (error) {
    console.error('❌ Gemini Chat Session Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * ส่งข้อความในสนทนาต่อเนื่อง
 * @param {string} sessionId - Session ID
 * @param {string} message - ข้อความใหม่
 * @param {Object} context - บริบทเพิ่มเติม
 * @returns {Promise<Object>} - ผลลัพธ์
 */
async function continueConversation(sessionId, message, context = {}) {
  try {
    // เพิ่มข้อความใหม่ลง history
    chatHistoryStore.addMessageToHistory(sessionId, 'user', message);

    // ดึง history ทั้งหมด
    const history = chatHistoryStore.getHistory(sessionId);

    // สร้าง context string จาก history
    let historyContext = '';
    if (history.length > 1) {
      // แสดง 2-3 ข้อความก่อนหน้า
      const recentHistory = history.slice(Math.max(0, history.length - 6));
      historyContext = '**ประวัติการสนทนา:**\n';
      for (const msg of recentHistory) {
        const role = msg.role === 'user' ? 'ผู้ใช้' : 'ตัวช่วย';
        historyContext += `${role}: ${msg.content}\n`;
      }
      historyContext += '\n';
    }

    // สร้าง prompt พร้อม context
    let prompt = historyContext + `**คำถามใหม่:** ${message}`;
    if (context.category) {
      prompt = `[หมวดหมู่: ${context.category}]\n${prompt}`;
    }

    const result = await geminiService.chat(prompt);

    if (result.success) {
      // เพิ่มคำตอบลง history
      chatHistoryStore.addMessageToHistory(sessionId, 'assistant', result.message);

      return {
        success: true,
        message: result.message,
        sessionId: sessionId,
        history: chatHistoryStore.getHistory(sessionId),
        messageCount: chatHistoryStore.getHistory(sessionId).length,
      };
    }

    return {
      success: false,
      error: result.error,
    };
  } catch (error) {
    console.error('❌ Gemini Continue Conversation Error:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * ลบประวัติสนทนา
 * @param {string} sessionId - Session ID
 */
function clearConversation(sessionId) {
  chatHistoryStore.clearHistory(sessionId);
  return { success: true, message: 'Conversation cleared' };
}

module.exports = {
  getAIResponse,
  enhanceAnswer,
  refineAnswer,
  startChatSession,
  continueConversation,
  clearConversation,
};
