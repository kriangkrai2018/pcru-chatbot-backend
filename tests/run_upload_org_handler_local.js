const mysql = require('mysql2/promise');
const path = require('path');
const uploadOrganizationsService = require('../services/Organizations/uploadOrganizations');

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'project.3bbddns.com',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pcru_auto_response',
    waitForConnections: true,
    connectionLimit: 5
  });

  const handler = uploadOrganizationsService(pool);

  const req = {
    user: { userId: 1001, usertype: 'Admin' },
    body: { allowExactDuplicates: 'true' },
    query: {},
    file: { path: path.resolve(__dirname, 'tmp_organizations.csv'), originalname: 'tmp_organizations.csv', mimetype: 'text/csv' },
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

    // Inspect DB counts for OrgName 'TestOrg'
    const [rows] = await pool.query("SELECT OrgName, COUNT(*) as c FROM Organizations WHERE OrgName LIKE 'TestOrg%' GROUP BY OrgName");
    console.log('DB check for TestOrg variants:', rows);

  } catch (err) {
    console.error('Test failed:', err && err.message ? err.message : err);
  } finally {
    await pool.end();
  }
})();
