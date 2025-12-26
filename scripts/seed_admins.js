// scripts/seed_admins.js
// Run this from the backend folder to add two sample admin users (one admin, one superadmin)
// Usage:
//  cd pcru-chatbot-backend
//  npm install bcryptjs mysql2 --no-save
//  node scripts/seed_admins.js

require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  try {
    const pool = mysql.createPool({
      host: process.env.DB_HOST || 'project.3bbddns.com',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'pcru_chatbot',
      waitForConnections: true,
      connectionLimit: 5
    });

    const conn = await pool.getConnection();

    // Insert an admin
    const adminPassword = await bcrypt.hash('Password123!', 10);
    const [res1] = await conn.query(
      `INSERT INTO AdminUsers (AdminName, AdminEmail, AdminPassword, ParentAdminID) VALUES (?, ?, ?, ?)`,
      ['Sample Admin', 'sample.admin@example.com', adminPassword, 1]
    );
    console.log('Inserted Sample Admin with id', res1.insertId);

    // Insert a superadmin (we'll set ParentAdminID to its own id after insert)
    const superPassword = await bcrypt.hash('SuperPass123!', 10);
    const [res2] = await conn.query(
      `INSERT INTO AdminUsers (AdminName, AdminEmail, AdminPassword, ParentAdminID) VALUES (?, ?, ?, ?)`,
      ['Super Admin', 'super.admin@example.com', superPassword, 1]
    );
    const superId = res2.insertId;
    // Set ParentAdminID = AdminUserID to mark as superadmin
    await conn.query(`UPDATE AdminUsers SET ParentAdminID = ? WHERE AdminUserID = ?`, [superId, superId]);
    console.log('Inserted Super Admin with id', superId);

    conn.release();
    await pool.end();
    console.log('Seeding complete.');
  } catch (err) {
    console.error('Seeding failed:', err.message || err);
    process.exit(1);
  }
})();