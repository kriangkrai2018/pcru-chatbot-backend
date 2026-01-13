#!/usr/bin/env node

require('dotenv').config();
const gemini = require('./services/gemini');

(async () => {
  console.log('🔍 ทดสอบเชื่อมต่อ Gemini API (Production Mode)...');
  console.log('API Key:', process.env.GOOGLE_GEMINI_API_KEY?.substring(0, 20) + '...');
  console.log('Mock Mode:', process.env.GEMINI_MOCK_MODE);
  console.log('');
  
  try {
    const result = await gemini.testConnection();
    console.log('📋 ผลลัพธ์:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.success && !result.isMock) {
      console.log('\n✅ เชื่อมต่อ API สำเร็จ! ไม่มี Error!');
      console.log('🎉 Gemini API พร้อมใช้งานแล้ว!');
      process.exit(0);
    } else if (result.isMock) {
      console.log('\n⚠️  ยังใช้ Mock Mode');
      process.exit(0);
    } else {
      console.log('\n❌ มี Error');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
