// /config.js

const dotenv = require('dotenv');
dotenv.config(); // โหลดค่าจากไฟล์ .env เข้าสู่ process.env

const config = {
    CLIENT_URL: process.env.CLIENT_URL || 'http://project.3bbddns.com:5173'
};

module.exports = config; 