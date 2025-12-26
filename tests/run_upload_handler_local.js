const mysql = require('mysql2/promise');
const path = require('path');
const uploadCategoriesService = require('../services/Categories/uploadCategories');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    waitForConnections: true,
    connectionLimit: 5
  });

  const handler = uploadCategoriesService(pool);

  const req = {
    user: { userId: 999, usertype: 'Admin' },
    body: { allowExactDuplicates: 'true' },
    query: {},
    file: { path: path.resolve(__dirname, 'tmp_categories.csv'), originalname: 'tmp_categories.csv', mimetype: 'text/csv' },
    files: undefined,
    headers: {}
  };

  const res = {
    statusCode: 200,
    _body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this._body = obj; console.log('RESPONSE', this.statusCode, JSON.stringify(obj, null, 2)); return obj; }
  };

  try {
    await handler(req, res);

    // Inspect DB counts for CategoriesID '1'
    const [rows] = await pool.query("SELECT CategoriesID, COUNT(*) as c FROM Categories WHERE CategoriesID = '1' GROUP BY CategoriesID");
    console.log('DB check for CategoriesID=1:', rows);

  } catch (err) {
    console.error('Test failed:', err && err.message ? err.message : err);
  } finally {
    await pool.end();
  }
})();
