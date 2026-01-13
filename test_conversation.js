#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'http://localhost:36145/api/gemini';
const SESSION_ID = 'test-user-' + Date.now();

async function test() {
  console.log('🧪 ทดสอบ Conversation History\n');
  console.log(`Session ID: ${SESSION_ID}\n`);

  try {
    // คำถาม 1
    console.log('❓ คำถามที่ 1: "มีหอพักไหม"');
    const response1 = await axios.post(`${BASE_URL}/conversation`, {
      message: 'มีหอพักไหม',
      sessionId: SESSION_ID,
      context: 'สอบถามเรื่องหอพัก',
    });

    console.log('✅ ตอบ:', response1.data.message);
    console.log('📊 History length:', response1.data.messageCount, '\n');

    // คำถาม 2 (เชื่อมโยงจากก่อนหน้า)
    console.log('❓ คำถามที่ 2: "แล้วมีสำหรับผู้หญิงไหม"');
    const response2 = await axios.post(`${BASE_URL}/conversation`, {
      message: 'แล้วมีสำหรับผู้หญิงไหม',
      sessionId: SESSION_ID,
      context: 'สอบถามเรื่องหอพัก',
    });

    console.log('✅ ตอบ:', response2.data.message);
    console.log('📊 History length:', response2.data.messageCount, '\n');

    // คำถาม 3
    console.log('❓ คำถามที่ 3: "แล้วว่างกี่ห้อง"');
    const response3 = await axios.post(`${BASE_URL}/conversation`, {
      message: 'แล้วว่างกี่ห้อง',
      sessionId: SESSION_ID,
      context: 'สอบถามเรื่องหอพัก',
    });

    console.log('✅ ตอบ:', response3.data.message);
    console.log('📊 History length:', response3.data.messageCount, '\n');

    console.log('✅ ทดสอบเสร็จสิ้น!');
    console.log(
      '\n💡 หมายเหตุ: AI จะเข้าใจบริบทจากคำถามก่อนหน้า เช่น "มี่" = "หอพัก"'
    );

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

// รอให้ server เริ่มก่อน
setTimeout(test, 2000);
