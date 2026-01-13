/**
 * Gemini AI Integration Module
 * สำหรับ integrate Gemini AI เข้ากับระบบ chat respond ของ PCRU
 */

const geminiService = require('../gemini');

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

module.exports = {
  getAIResponse,
  enhanceAnswer,
  refineAnswer,
};
