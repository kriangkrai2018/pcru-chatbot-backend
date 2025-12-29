const fs = require('fs').promises;
const path = require('path');

/**
 * Export current AdminUsers to CSV and save under files/manageadminusers/<uploaderId>/
 * Returns the written file path.
 */
const writeAdminUsersCSV = (pool, uploaderId = 1) => async () => {
  if (!pool) throw new Error('Database pool required');
  if (!uploaderId) uploaderId = 1;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseDir = path.join(__dirname, '..', '..', 'files', 'manageadminusers', String(uploaderId));
  const filenameLatest = `adminusers_export_latest.csv`;
  const tmpFilename = `adminusers_export_${timestamp}.tmp`;
  const tmpPath = path.join(baseDir, tmpFilename);
  const latestPath = path.join(baseDir, filenameLatest);

  await fs.mkdir(baseDir, { recursive: true });

  // Fetch admin users
  const [rows] = await pool.query(`
    SELECT AdminUserID, AdminName, AdminEmail, ParentAdminID
    FROM AdminUsers ORDER BY AdminUserID ASC
  `);

  // Prepare CSV content
  const headers = ['AdminUserID', 'AdminName', 'AdminEmail', 'ParentAdminID'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const cols = [r.AdminUserID, escapeCsv(String(r.AdminName || '')), escapeCsv(String(r.AdminEmail || '')), r.ParentAdminID == null ? '' : r.ParentAdminID];
    lines.push(cols.join(','));
  }

  const csvContent = lines.join('\n') + '\n';

  console.log(`🔁 writeAdminUsersCSV: starting write for uploaderId=${uploaderId}, tmp=${tmpPath}`);
  try {
    await fs.writeFile(tmpPath, csvContent, 'utf8');
    await fs.rename(tmpPath, latestPath);
    console.log(`✅ writeAdminUsersCSV: wrote latestPath=${latestPath}`);
  } catch (err) {
    console.error('❌ writeAdminUsersCSV: failed to write/rename file', err && (err.message || err));
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
          console.log(`🧹 writeAdminUsersCSV: removed old file ${p}`);
        }
      } catch (err) {
        console.error('Failed to remove non-latest file in adminusers dir', f, err && err.message);
      }
    }
  } catch (err) {
    console.error('Error cleaning up adminusers export files:', err && err.message);
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

module.exports = writeAdminUsersCSV;
