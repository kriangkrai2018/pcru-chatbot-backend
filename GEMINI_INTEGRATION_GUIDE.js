/**
 * ตัวอย่างการ integrate Gemini AI เข้ากับระบบ chat respond
 * 
 * ใช้วิธีใดวิธีหนึ่งตามต้องการ:
 * 1. แสดง Fallback - ถ้าไม่มีคำตอบ ให้ AI ตอบ
 * 2. Enhance - ปรับปรุงคำตอบเดิม ให้ดูธรรมชาติ
 * 3. Hybrid - ลองระบบเดิม ถ้าไม่ได้ลองก็ให้ AI ตอบ
 */

const geminiIntegration = require('./services/chat/geminiIntegration');

// ========================================
// วิธี 1: Fallback Mode (แนะนำ)
// ========================================
// ถ้าไม่มีคำตอบจากระบบเดิม ให้ AI ตอบแทน

async function respondWithAIFallback(question, foundAnswers, category) {
  // ถ้ามีคำตอบจากระบบเดิม ให้ใช้นั้น
  if (foundAnswers && foundAnswers.length > 0) {
    return {
      success: true,
      answers: foundAnswers,
      source: 'keyword-matching', // มาจากการ matching keyword
    };
  }

  // ถ้าไม่มี ให้ใช้ AI ตอบ
  const aiResponse = await geminiIntegration.getAIResponse(question, {
    category: category,
  });

  if (aiResponse.success) {
    return {
      success: true,
      answers: [
        {
          QuestionTitle: 'ตอบโดย AI',
          QuestionText: question,
          AnswerText: aiResponse.answer,
        },
      ],
      source: 'ai', // มาจาก AI
      aiGenerated: true,
    };
  }

  // ถ้า AI error ด้วย ให้ส่ง "ไม่มีคำตอบ"
  return {
    success: false,
    message: 'ขอโทษค่ะ ไม่พบคำตอบ กรุณาติดต่อเจ้าหน้าที่',
  };
}

// ========================================
// วิธี 2: Enhance Mode
// ========================================
// ปรับปรุงคำตอบจากระบบเดิมให้ดูธรรมชาติ

async function respondWithAIEnhance(question, foundAnswers, category) {
  // ถ้าไม่มีคำตอบ ก็ไม่ต้องปรับปรุง
  if (!foundAnswers || foundAnswers.length === 0) {
    return { success: false, message: 'ไม่พบคำตอบ' };
  }

  // ปรับปรุงคำตอบแรก
  const firstAnswer = foundAnswers[0];
  const enhanced = await geminiIntegration.enhanceAnswer(
    question,
    firstAnswer.AnswerText,
    { category: category }
  );

  if (enhanced.success) {
    return {
      success: true,
      answers: [
        {
          ...firstAnswer,
          AnswerText: enhanced.answer, // ใช้คำตอบที่ปรับปรุง
          enhanced: true, // บ่งบอกว่าปรับปรุงแล้ว
        },
      ],
      source: 'ai-enhanced',
    };
  }

  // ถ้า enhance fail ให้ส่งคำตอบเดิม
  return {
    success: true,
    answers: foundAnswers,
    source: 'keyword-matching',
  };
}

// ========================================
// วิธี 3: Hybrid Mode (ดีที่สุด)
// ========================================
// ลองระบบเดิมก่อน ถ้าไม่ได้ให้ AI ตอบ และปรับปรุงคำตอบ

async function respondWithAIHybrid(question, foundAnswers, category) {
  // ถ้ามีคำตอบจากระบบเดิม ให้ปรับปรุง
  if (foundAnswers && foundAnswers.length > 0) {
    const enhanced = await geminiIntegration.enhanceAnswer(
      question,
      foundAnswers[0].AnswerText,
      { category: category }
    );

    return {
      success: true,
      answers: [
        {
          ...foundAnswers[0],
          AnswerText: enhanced.answer,
          enhanced: true,
          source: 'keyword-matching-enhanced',
        },
      ],
    };
  }

  // ถ้าไม่มี ให้ AI ตอบแทน
  const aiResponse = await geminiIntegration.getAIResponse(question, {
    category: category,
  });

  if (aiResponse.success) {
    return {
      success: true,
      answers: [
        {
          QuestionTitle: 'ตอบโดย AI Assistant',
          QuestionText: question,
          AnswerText: aiResponse.answer,
          aiGenerated: true,
        },
      ],
      source: 'ai',
    };
  }

  return {
    success: false,
    message: 'ขอโทษค่ะ ไม่สามารถตอบคำถามนี้ได้ กรุณาติดต่อเจ้าหน้าที่',
  };
}

// ========================================
// วิธีใช้ในไฟล์ respond.js
// ========================================

/**
 * ในไฟล์ respond.js ที่บรรทัดที่ส่ง response ให้ Frontend
 * ให้เปลี่ยนจาก:
 * 
 * res.json({ success: true, answers: foundAnswers });
 * 
 * เป็น (เลือก 1 วิธี):
 * 
 * // Fallback Mode
 * const result = await respondWithAIFallback(question, foundAnswers, category);
 * 
 * // หรือ Enhance Mode
 * const result = await respondWithAIEnhance(question, foundAnswers, category);
 * 
 * // หรือ Hybrid Mode (แนะนำ)
 * const result = await respondWithAIHybrid(question, foundAnswers, category);
 * 
 * res.json(result);
 */

module.exports = {
  respondWithAIFallback,
  respondWithAIEnhance,
  respondWithAIHybrid,
};
