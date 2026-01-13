/**
 * Gemini AI Routes
 * API endpoints สำหรับ Gemini AI
 */

const express = require('express');
const router = express.Router();
const geminiService = require('../services/gemini');
const geminiIntegration = require('../services/chat/geminiIntegration');

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

    const result = await geminiIntegration.continueConversation(
      sessionId,
      message,
      context || {}
    );

    if (result.success) {
      return res.json(result);
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
    const maxTokens = parseInt(process.env.AUTOCOMPLETE_MAX_TOKENS) || 5;
    const backendTimeout = parseInt(process.env.AUTOCOMPLETE_BACKEND_TIMEOUT_MS) || 4000;
    
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
      
      // Limit total length to ~30 characters
      if (suggestion.length > 30) {
        suggestion = suggestion.slice(0, 30);
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
