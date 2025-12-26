const mysql = require('mysql2/promise');
require('dotenv').config();

(async ()=>{
  const pool = await mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    waitForConnections: true,
    connectionLimit: 2
  });

  const services = [
    'getOrganizations','getChatLogHasAnswers','getKeywords','getQuestionsAnswers','getCategories','getAnswersKeywords','getOfficers','getChatLogNoAnswers','getFeedbacks','getAdminUsers'
  ];

  for (const s of services) {
    try {
      const fn = require(`../services/reports/${s}`)(pool);
      const mockReq = { query: {}, user: { userId: 1, usertype: 'Admin' } };
      const res = {
        status: (code) => ({ json: (body) => { console.log(s, '->', Array.isArray(body) ? body.slice(0,3) : body); } })
      };
      await fn(mockReq, res);
    } catch (e) {
      console.error(s, 'error', e && e.message);
    }
  }

  await pool.end();
})();