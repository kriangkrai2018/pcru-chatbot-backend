const fs = require('fs').promises;
const path = require('path');

/**
 * Export current Officers to CSV and save under files/manageofficers/<uploaderId>/
 * Returns the written file path.
 */
const writeOfficersCSV = (pool, uploaderId = 1) => async () => {
  if (!pool) throw new Error('Database pool required');
  if (!uploaderId) uploaderId = 1;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = path.join(__dirname, '..', '..', 'files', 'manageofficers', String(uploaderId));
  const filenameLatest = `officers_export_latest.csv`;
  const tmpFilename = `officers_export_${timestamp}.tmp`;
  const tmpPath = path.join(baseDir, tmpFilename);
  const latestPath = path.join(baseDir, filenameLatest);

  await fs.mkdir(baseDir, { recursive: true });

  // Fetch officers. If uploaderId === 1001 (shared export), export all officers.
  // Otherwise export only officers that belong to the uploader (AdminUserID = uploaderId).
  let rows;
  // Detect whether Officers table has an OfficerStatus column (some DBs may not)
  const [colsInfo] = await pool.query(`
    SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Officers' AND COLUMN_NAME = 'OfficerStatus'
  `, [process.env.DB_NAME || 'pcru_auto_response']);
  const hasStatus = colsInfo && colsInfo[0] && Number(colsInfo[0].cnt) > 0;

  // Build select depending on availability of status column
  if (Number(uploaderId) === 1001) {
    const select = hasStatus
      ? `SELECT OfficerID, OfficerName, OfficerPhone, Email AS OfficerEmail, OfficerStatus, OrgID FROM Officers ORDER BY OfficerID ASC`
      : `SELECT OfficerID, OfficerName, OfficerPhone, Email AS OfficerEmail, OrgID FROM Officers ORDER BY OfficerID ASC`;
    const [r] = await pool.query(select);
    rows = r;
  } else {
    const select = hasStatus
      ? `SELECT OfficerID, OfficerName, OfficerPhone, Email AS OfficerEmail, OfficerStatus, OrgID FROM Officers WHERE AdminUserID = ? ORDER BY OfficerID ASC`
      : `SELECT OfficerID, OfficerName, OfficerPhone, Email AS OfficerEmail, OrgID FROM Officers WHERE AdminUserID = ? ORDER BY OfficerID ASC`;
    const [r] = await pool.query(select, [uploaderId]);
    rows = r;
  }

  const headers = hasStatus ? ['OfficerName', 'OfficerPhone', 'OfficerEmail', 'OfficerStatus', 'OrgID'] : ['OfficerName', 'OfficerPhone', 'OfficerEmail', 'OrgID'];
  const lines = [headers.join(',')];
  rows.forEach((r) => {
    const cols = [
      escapeCsv(String(r.OfficerName || '')),
      escapeCsv(String(r.OfficerPhone || '')),
      escapeCsv(String(r.OfficerEmail || '')),
    ];
    if (hasStatus) cols.push(escapeCsv(String(typeof r.OfficerStatus !== 'undefined' ? r.OfficerStatus : '')));
    cols.push(escapeCsv(String(r.OrgID || '')));
    lines.push(cols.join(','));
  });

  // Add UTF-8 BOM so Excel (and other apps) correctly detect UTF-8 with non-ASCII characters
  const csvContent = '\uFEFF' + (lines.join('\n') + '\n');

  console.log(`🔁 writeOfficersCSV: starting write for uploaderId=${uploaderId}, tmp=${tmpPath}`);
  try {
    await fs.writeFile(tmpPath, csvContent, 'utf8');
    await fs.rename(tmpPath, latestPath);
    console.log(`✅ writeOfficersCSV: wrote latestPath=${latestPath}`);
  } catch (err) {
    console.error('❌ writeOfficersCSV: failed to write/rename file', err && (err.message || err));
    throw err;
  }

  // Cleanup: remove any other files in directory except latest
  try {
    const files = await fs.readdir(baseDir);
    for (const f of files) {
      if (f === filenameLatest) continue;
      try {
        const p = path.join(baseDir, f);
        const st = await fs.stat(p);
        if (st.isFile()) {
          await fs.unlink(p);
          console.log(`🧹 writeOfficersCSV: removed old file ${p}`);
        }
      } catch (err) {
        console.error('Failed to remove non-latest file in officers dir', f, err && err.message);
      }
    }
  } catch (err) {
    console.error('Error cleaning up officers export files:', err && err.message);
  }

  return { latestPath };
};

function escapeCsv(value) {
  if (value == null) return '';
  if (/[",\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

module.exports = writeOfficersCSV;
