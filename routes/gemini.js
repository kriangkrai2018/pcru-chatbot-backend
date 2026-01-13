/**
 * Gemini AI Routes
 * API endpoints สำหรับ Gemini AI
 */

const express = require('express');
const router = express.Router();
const geminiService = require('../services/gemini');

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

module.exports = router;
