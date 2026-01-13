#!/usr/bin/env node

require('dotenv').config();
const express = require('express');
const geminiRoute = require('./routes/gemini');

const app = express();
app.use(express.json());
app.use('/api/gemini', geminiRoute);

const PORT = 3333;
const server = app.listen(PORT, () => {
  console.log(`✅ Test server running on http://localhost:${PORT}`);
});

// Test endpoints
setTimeout(async () => {
  try {
    console.log('\n🧪 Testing /api/gemini/test...');
    const https = require('http');
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/api/gemini/test',
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        console.log('Response:', body);
        server.close();
        process.exit(0);
      });
    });

    req.on('error', (err) => {
      console.error('Error:', err);
      server.close();
      process.exit(1);
    });

    req.end();
  } catch (error) {
    console.error('Test failed:', error);
    server.close();
    process.exit(1);
  }
}, 1000);
