#!/usr/bin/env node

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const chatRespondService = require('./services/chat/respond');

const app = express();
app.use(express.json());

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

  // ทดสอบ 1 วินาทีหลังเริ่ม server
  setTimeout(async () => {
    try {
      const http = require('http');

      console.log('\n🧪 ทดสอบเมื่อไม่มีคำตอบ (ให้ AI ตอบ)...\n');

      const testData = JSON.stringify({
        message: 'ไก่ที่ไม่เกี่ยวข้อง', // คำถามที่ไม่มีคำตอบในระบบ
      });

      const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/chat/respond',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': testData.length,
        },
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            console.log('📋 Response:');
            console.log(JSON.stringify(response, null, 2));

            if (response.aiGenerated) {
              console.log('\n✅ AI ตอบแทนได้สำเร็จ!');
            } else if (response.enhanced) {
              console.log('\n✅ ปรับปรุงคำตอบด้วย AI สำเร็จ!');
            }
          } catch (e) {
            console.error('Parse error:', e);
          }

          server.close();
          process.exit(0);
        });
      });

      req.on('error', (err) => {
        console.error('Request error:', err);
        server.close();
        process.exit(1);
      });

      req.write(testData);
      req.end();
    } catch (error) {
      console.error('Test error:', error);
      server.close();
      process.exit(1);
    }
  }, 1000);
});
