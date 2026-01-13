/**
 * Test script to verify Gemini model version
 */

require('dotenv').config();
const gemini = require('./services/gemini');

async function testGeminiModel() {
  console.log('🧪 Testing Gemini Model Configuration...\n');
  console.log('📋 Environment Variables:');
  console.log(`   GEMINI_MODEL: ${process.env.GEMINI_MODEL}`);
  console.log(`   GEMINI_TEMPERATURE: ${process.env.GEMINI_TEMPERATURE}`);
  console.log(`   GEMINI_TOP_P: ${process.env.GEMINI_TOP_P}`);
  console.log(`   GEMINI_TOP_K: ${process.env.GEMINI_TOP_K}`);
  console.log(`   GEMINI_MAX_OUTPUT_TOKENS: ${process.env.GEMINI_MAX_OUTPUT_TOKENS}`);
  console.log('\n🤖 Testing Gemini API...\n');

  try {
    const result = await gemini.chat('สวัสดี ตอบแค่ว่า "สวัสดีครับ" เท่านั้น');
    
    if (result.success) {
      console.log('✅ Gemini API Response:');
      console.log(`   Message: ${result.message}`);
      console.log(`   Tokens: ${result.usage.totalTokens}`);
      console.log('\n✅ TEST PASSED - Gemini is working correctly!');
    } else {
      console.log('❌ Gemini API Error:');
      console.log(`   Error: ${result.error}`);
      console.log(`   Code: ${result.code}`);
      console.log('\n❌ TEST FAILED');
    }
  } catch (error) {
    console.error('❌ Test Error:', error.message);
    console.log('\n❌ TEST FAILED');
  }
}

testGeminiModel();
