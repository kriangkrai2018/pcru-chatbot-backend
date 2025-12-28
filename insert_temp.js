const { Pool } = require('pg');

require('dotenv').config();

const pool = new Pool({

  host: process.env.DB_HOST || 'localhost',

  port: process.env.DB_PORT || 5432,

  user: process.env.DB_USER || 'root',

  password: process.env.DB_PASSWORD || '',

  database: process.env.DB_NAME || 'pcru_auto_response'

});

async function insert() {

  try {

    await pool.query("INSERT INTO suggested_intent_hints (intent, hint, suggested_by) VALUES ($1, $2, $3)", ['กองพัฒนานักศึกษา', 'แสดง context ของแต่ละประเภท จอยกับ เจ้าหน้าที่ จอย กับ หน่วยงาน', 'user']);

    await pool.query("INSERT INTO suggested_intent_hints (intent, hint, suggested_by) VALUES ($1, $2, $3)", ['สำนักส่งเสริมวิชาการและงานทะเบียน', '', 'user']);

    console.log('Inserted successfully');

  } catch (err) {

    console.error(err);

  } finally {

    pool.end();

  }

}

insert();