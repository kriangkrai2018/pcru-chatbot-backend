#!/usr/bin/env node

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const chatRespondService = require('./services/chat/respond');

const app = express();
app.use(express.json({ limit: '10mb' }));

// สร้าง pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 2,
  queueLimit: 0,
});

// mount route
app.post('/chat/respond', chatRespondService(pool));

const PORT = 3334;
const server = app.listen(PORT, async () => {
  console.log(`✅ Test server running on port ${PORT}`);

  // ทดสอบ 2 วินาทีหลังเริ่ม server
  setTimeout(async () => {
    try {
      const axios = require('axios');

      console.log('\n🧪 ทดสอบเมื่อไม่มีคำตอบ (ให้ AI ตอบ)...\n');

      const response = await axios.post('http://localhost:3334/chat/respond', {
        message: 'พูดเรื่องแมว',
      });

      console.log('📋 Response Status:', response.status);
      console.log('📋 Response Data:');
      console.log(JSON.stringify(response.data, null, 2));

      if (response.data.aiGenerated) {
        console.log('\n✅ AI ตอบแทนได้สำเร็จ!');
      } else if (response.data.alternatives[0]?.enhanced) {
        console.log('\n✅ ปรับปรุงคำตอบด้วย AI สำเร็จ!');
      }

      server.close();
      process.exit(0);
    } catch (error) {
      console.error('❌ Error:', error.message);
      if (error.response) {
        console.error('Response:', error.response.data);
      }
      server.close();
      process.exit(1);
    }
  }, 2000);
});
