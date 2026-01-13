#!/usr/bin/env node

require('dotenv').config();

// ทดสอบ import geminiIntegration
console.log('🧪 ทดสอบ Import geminiIntegration...');
const geminiIntegration = require('./services/chat/geminiIntegration');

console.log('✅ Import สำเร็จ!');
console.log('Functions ที่ได้:', Object.keys(geminiIntegration));

(async () => {
  console.log('\n🔍 ทดสอบ getAIResponse...');
  const result = await geminiIntegration.getAIResponse('สวัสดี');
  console.log('ผลลัพธ์:', JSON.stringify(result, null, 2));

  console.log('\n🔍 ทดสอบ enhanceAnswer...');
  const enhanced = await geminiIntegration.enhanceAnswer('สวัสดี', 'ติดต่อ สำนักอธิการบดี');
  console.log('ผลลัพธ์:', JSON.stringify(enhanced, null, 2));

  console.log('\n✅ ทดสอบเสร็จสิ้น!');
  process.exit(0);
})();
