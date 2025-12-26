const mysql = require('mysql2/promise');
const path = require('path');
const uploadQuestionsAnswersService = require('../services/QuestionsAnswers/uploadQuestionsAnswers');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    waitForConnections: true,
    connectionLimit: 5
  });

  const handler = uploadQuestionsAnswersService(pool);

  const req = {
    app: { locals: {} },
    user: { userId: 1001, usertype: 'Admin' },
    body: { allowExactDuplicates: 'true' },
    query: {},
    file: { path: path.resolve(__dirname, 'tmp_questionsanswers.csv'), originalname: 'tmp_questionsanswers.csv', mimetype: 'text/csv' },
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

    // Inspect DB counts for QuestionTitle 'หมวดเดียว'
    const [rows] = await pool.query("SELECT QuestionTitle, COUNT(*) as c FROM QuestionsAnswers WHERE QuestionTitle = 'หมวดเดียว' GROUP BY QuestionTitle");
    console.log('DB check for หมวดเดียว:', rows);

  } catch (err) {
    console.error('Test failed:', err && err.message ? err.message : err);
  } finally {
    await pool.end();
  }
})();
