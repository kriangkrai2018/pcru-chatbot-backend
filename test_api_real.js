#!/usr/bin/env node

require('dotenv').config();
const gemini = require('./services/gemini');

(async () => {
  console.log('🔍 ทดสอบ Gemini API (Production Mode)...');
  console.log('GEMINI_MOCK_MODE:', process.env.GEMINI_MOCK_MODE);
  console.log('\n');
  
  const result = await gemini.testConnection();
  console.log('📋 ผลการทดสอบ:');
  console.log(JSON.stringify(result, null, 2));
  
  if (result.success && !result.isMock) {
    console.log('\n✅ API ทำงานปกติแล้ว!');
    process.exit(0);
  } else if (result.isMock) {
    console.log('\n⚠️  ยังใช้ Mock Mode อยู่');
    process.exit(0);
  } else {
    console.log('\n❌ API ยังมีปัญหา');
    process.exit(1);
  }
})();
