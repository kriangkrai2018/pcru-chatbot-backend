#!/usr/bin/env node

/**
 * Update Stopwords Table with Comprehensive Thai Stopwords
 * Based on pythainlp standard stopwords list
 * 
 * Usage: node update_stopwords.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Database configuration (from environment or default)
const dbConfig = {
  host: process.env.DB_HOST || 'project.3bbddns.com',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pcru_chatbot',
  charset: 'utf8mb4'
};

async function updateStopwords() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Connected to database');

    // Read SQL file
    const sqlFile = path.join(__dirname, '../database/update_stopwords_pythainlp.sql');
    console.log(`📄 Reading SQL file: ${sqlFile}`);
    
    if (!fs.existsSync(sqlFile)) {
      throw new Error(`SQL file not found: ${sqlFile}`);
    }
    
    const sql = fs.readFileSync(sqlFile, 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`📝 Executing ${statements.length} SQL statements...`);
    
    for (const statement of statements) {
      if (statement.toUpperCase().includes('INSERT') || 
          statement.toUpperCase().includes('SELECT') ||
          statement.toUpperCase().includes('COMMIT')) {
        await connection.query(statement);
      }
    }
    
    // Get final count
    const [rows] = await connection.query('SELECT COUNT(*) as total FROM Stopwords');
    const totalStopwords = rows[0].total;
    
    console.log(`\n✅ Stopwords update completed successfully!`);
    console.log(`📊 Total stopwords in database: ${totalStopwords}`);
    
    // Show sample
    console.log(`\n📋 Sample stopwords:`);
    const [sampleRows] = await connection.query(
      'SELECT StopwordText FROM Stopwords ORDER BY StopwordText LIMIT 20'
    );
    sampleRows.forEach(row => {
      console.log(`   - ${row.StopwordText}`);
    });
    
    // Clear stopwords cache in the running application
    console.log(`\n💡 Note: If the application is running, restart it to reload stopwords cache.`);
    
  } catch (error) {
    console.error('❌ Error updating stopwords:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run the update
updateStopwords().then(() => {
  console.log('\n✨ Done!');
  process.exit(0);
});
