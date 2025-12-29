// services/Categories/uploadCategories.js
// Requires: npm install csv-parser validator
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const validator = require('validator');

const uploadCategoriesService = (pool) => async (req, res) => {
    // Debug headers and file info
    console.log('[uploadCategories] Start. Content-Type:', req.headers['content-type']);

    const uploaderId = req.user?.userId;
    if (!uploaderId) {
        return res.status(401).json({ success: false, message: 'Unauthorized: uploader not identified.' });
    }

    // 1. Prepare User Directory
    const userUploadDir = path.join(__dirname, '..', '..', 'files', 'managecategories', String(uploaderId));
    try {
        await fs.promises.mkdir(userUploadDir, { recursive: true });
    } catch (e) {
        console.error('[uploadCategories] Failed to create dir:', e);
        return res.status(500).json({ success: false, message: 'Server file system error.' });
    }

    // Helper to clear directory
    async function clearUserDir(dir, keepPath = null) {
        try {
            const entries = await fs.promises.readdir(dir);
            for (const entry of entries) {
                const entryPath = path.join(dir, entry);
                if (keepPath && path.resolve(entryPath) === path.resolve(keepPath)) continue;
                try {
                    await fs.promises.rm(entryPath, { recursive: true, force: true });
                } catch (e) { /* ignore */ }
            }
        } catch (e) { /* ignore */ }
    }

    // 2. Handle File Upload (Multer or Body)
    // If multer used upload.any()
    if (!req.file && Array.isArray(req.files) && req.files.length > 0) {
        req.file = req.files[0];
    }

    // Determine final file path
    let filePath = null;
    let tempCreated = false;

    if (req.file && req.file.path) {
        // Move file to user directory if not already there
        const currentPath = req.file.path;
        const targetName = `upload_categories_${Date.now()}_${req.file.originalname || 'data.csv'}`;
        const targetPath = path.join(userUploadDir, targetName);
        
        await clearUserDir(userUploadDir, currentPath); // Clear old files

        try {
            // Try rename (move) first
            await fs.promises.rename(currentPath, targetPath);
            filePath = targetPath;
        } catch (err) {
            // Fallback to copy & delete
            try {
                await fs.promises.copyFile(currentPath, targetPath);
                await fs.promises.unlink(currentPath).catch(()=>{});
                filePath = targetPath;
            } catch (copyErr) {
                console.error('[uploadCategories] File move failed:', copyErr);
                return res.status(500).json({ success: false, message: 'Failed to save uploaded file.' });
            }
        }
    } else if (req.body && (typeof req.body === 'string' || req.body.csv || req.body.file)) {
        // Handle raw CSV content or Base64 in body
        try {
            let content = typeof req.body === 'string' ? req.body : (req.body.csv || req.body.file || '');
            // Simple Base64 check
            if (content.match(/^data:.*base64,/)) {
                content = content.split('base64,')[1];
                content = Buffer.from(content, 'base64');
            } else if (/^[A-Za-z0-9+/=\s]+$/.test(content.replace(/\r?\n/g,''))) {
                 // Try decode if it looks like base64
                 try { content = Buffer.from(content, 'base64'); } catch(e) { content = Buffer.from(content); }
            }
            
            const fileName = `upload_categories_body_${Date.now()}.csv`;
            filePath = path.join(userUploadDir, fileName);
            await clearUserDir(userUploadDir);
            await fs.promises.writeFile(filePath, content);
            tempCreated = true;
        } catch (err) {
            console.error('[uploadCategories] Body content write failed:', err);
            return res.status(400).json({ success: false, message: 'Invalid file content in request body.' });
        }
    }

    if (!filePath) {
        return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    // 3. Read & Parse CSV
    const rows = [];
    try {
        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv({ bom: true, mapHeaders: ({ header }) => header.trim() })) // Auto-strip BOM
                .on('data', (data) => {
                    // Normalize keys/values
                    const cleanData = {};
                    for (const [k, v] of Object.entries(data)) {
                        let val = v;
                        if (typeof val === 'string') {
                            // Clean Excel formula artifacts like ="Value"
                            val = val.trim().replace(/^=["'](.*)["']$/, '$1').replace(/^=["']/, '').replace(/["']$/, '');
                        }
                        cleanData[k] = val;
                    }
                    rows.push(cleanData);
                })
                .on('end', resolve)
                .on('error', reject);
        });
    } catch (err) {
        console.error('[uploadCategories] CSV Parse Error:', err);
        return res.status(400).json({ success: false, message: 'Failed to parse CSV file.' });
    }

    if (rows.length === 0) {
        return res.status(400).json({ success: false, message: 'CSV file is empty.' });
    }

    // 4. Process Data (Insert/Update)
    let connection;
    const summary = { total: rows.length, inserted: 0, failed: 0, skipped: 0 };
    const warnings = [];

    // Toggles for duplicate handling
    const allowDuplicates = req.body.allowDuplicates === 'true' || req.body.allowDuplicates === true;
    const allowExactDuplicates = req.body.allowExactDuplicates === 'true' || req.body.allowExactDuplicates === true;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const ownerOfficerId = (req.user && req.user.usertype === 'Officer') ? uploaderId : null;

        if (ownerOfficerId !== null) {
            const [officerCheck] = await connection.query('SELECT 1 FROM Officers WHERE OfficerID = ? LIMIT 1', [ownerOfficerId]);
            if (!officerCheck || officerCheck.length === 0) {
                console.warn(`[uploadCategories] uploaderId ${ownerOfficerId} not found in Officers table, setting to NULL`);
                ownerOfficerId = null;
            }
        }

        // Clean existing data if not append mode
        if (!allowDuplicates && !allowExactDuplicates) {
            if (ownerOfficerId === null) {
                // Admin clears global categories
                await connection.query('DELETE FROM Categories WHERE OfficerID IS NULL');
            } else {
                // Officer clears their own
                await connection.query('DELETE FROM Categories WHERE OfficerID = ?', [ownerOfficerId]);
            }
            // Contacts will cascade delete if FK exists, else delete manually:
            // await connection.query('DELETE cc FROM Categories_Contact cc JOIN Categories c ...');
        }

        const contactOps = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 1;

            // Map fields
            let id = row.CategoriesID || '';
            const name = row.CategoriesName || '';
            const pdf = row.CategoriesPDF || null;
            const contact = row.Contact || '';
            // Flexible parent column names
            const parentRaw = row.ParentCategoriesName || row.ParentCategoriesID || row.Parent || row.ParentCategory || '';

            if (!name) {
                summary.skipped++;
                continue;
            }

            // Step A: Determine Parent ID
            // Logic:
            // 1. If ParentRaw is empty OR same as name -> It's a Root (Level 0)
            // 2. If ParentRaw looks like ID (e.g. "1", "1-2") -> Use as ParentID
            // 3. If ParentRaw is a Name -> Lookup ID in DB (Transaction sees previous inserts)
            
            let parentID = null;
            let isLevel0 = false;

            if (!parentRaw || parentRaw.trim() === '' || parentRaw.trim().toLowerCase() === name.trim().toLowerCase()) {
                isLevel0 = true;
                parentID = null; // Will set to self-ID later if generated
            } else {
                // Try to interpret as ID
                if (/^\d+(-\d+)?$/.test(parentRaw)) {
                    parentID = parentRaw;
                } else {
                    // Lookup by Name
                    const [found] = await connection.query(
                        'SELECT CategoriesID FROM Categories WHERE CategoriesName = ? AND (OfficerID = ? OR OfficerID IS NULL) LIMIT 1',
                        [parentRaw.trim(), ownerOfficerId]
                    );
                    if (found.length > 0) {
                        parentID = found[0].CategoriesID;
                    } else {
                        // Parent not found? Fallback: treat as root or warn
                        // For now, treat as root to save data.
                        console.warn(`[uploadCategories] Row ${rowNum}: Parent "${parentRaw}" not found. Treating as Root.`);
                        isLevel0 = true;
                        parentID = null;
                    }
                }
            }

            // Step B: Resolve/Generate CategoriesID
            if (!id) {
                // ID missing, need to generate
                if (isLevel0) {
                    // Generate Root ID (e.g. 1, 2, 3...)
                    const [res] = await connection.query(
                        "SELECT MAX(CAST(CategoriesID AS UNSIGNED)) as maxId FROM Categories WHERE CategoriesID NOT LIKE '%-%'"
                    );
                    const nextNum = (res[0].maxId || 0) + 1;
                    id = String(nextNum);
                    // For root categories, ParentCategoriesID usually equals CategoriesID or is handled as group
                    // Based on example: Root has ParentCategoriesID = CategoriesID
                    parentID = id;
                } else {
                    // Generate Sub ID (e.g. 1-1, 1-2...)
                    // ParentID must be valid here (e.g. "1")
                    const [res] = await connection.query(
                        "SELECT CategoriesID FROM Categories WHERE ParentCategoriesID = ? AND CategoriesID LIKE ?",
                        [parentID, `${parentID}-%`]
                    );
                    
                    let maxSub = 0;
                    res.forEach(r => {
                        const parts = r.CategoriesID.split('-');
                        if (parts.length > 1) {
                            const n = parseInt(parts[parts.length - 1]);
                            if (n > maxSub) maxSub = n;
                        }
                    });
                    id = `${parentID}-${maxSub + 1}`;
                }
            } else {
                // ID provided in CSV, use it (and verify ParentID matches logic if needed)
                // If provided ID is "1", Parent should be "1".
                // If provided ID is "1-2", Parent should be "1".
                if (!parentID) {
                    parentID = id.includes('-') ? id.split('-')[0] : id;
                }
            }

            // Step C: Insert
            try {
                // Insert SQL
                // Note: On duplicate, we either fail (catch) or update if allowDuplicates
                const sql = `INSERT INTO Categories (CategoriesID, CategoriesName, ParentCategoriesID, CategoriesPDF, OfficerID) VALUES (?, ?, ?, ?, ?)`;
                // If allowDuplicates (Update mode)
                const upsertSql = `INSERT INTO Categories (CategoriesID, CategoriesName, ParentCategoriesID, CategoriesPDF, OfficerID) 
                                   VALUES (?, ?, ?, ?, ?) 
                                   ON DUPLICATE KEY UPDATE CategoriesName=VALUES(CategoriesName), ParentCategoriesID=VALUES(ParentCategoriesID), CategoriesPDF=VALUES(CategoriesPDF)`;

                const finalSql = allowDuplicates ? upsertSql : sql;
                
                await connection.query(finalSql, [id, name, parentID, pdf, ownerOfficerId]);
                
                // Track contact to add later
                if (contact) {
                    contactOps.push({ id, contact });
                }
                
                summary.inserted++;

            } catch (err) {
                // Duplicate entry error code is 1062
                if (err.code === 'ER_DUP_ENTRY' && !allowDuplicates && !allowExactDuplicates) {
                    warnings.push(`Row ${rowNum}: Duplicate ID ${id} or Name ignored.`);
                    summary.failed++;
                } else if (allowExactDuplicates) {
                    // If allowing exact duplicates (not recommended for PK but maybe for name), ignore error? 
                    // Usually PK cannot be dup.
                    console.warn(`[uploadCategories] Row ${rowNum} insert error:`, err.message);
                    summary.failed++;
                } else {
                    console.error(`[uploadCategories] Row ${rowNum} error:`, err);
                    summary.failed++;
                }
            }
        }

        // Step D: Update Contacts
        // Delete old contacts for touched categories (if upsert) and insert new
        for (const op of contactOps) {
            // Safe to delete and re-insert
            await connection.query('DELETE FROM Categories_Contact WHERE CategoriesID = ?', [op.id]);
            
            // Split contacts by common delimiters
            const parts = op.contact.split(/[,;|]+/).map(s => s.trim()).filter(Boolean);
            for (const c of parts) {
                await connection.query('INSERT INTO Categories_Contact (CategoriesID, Contact) VALUES (?, ?)', [op.id, c]);
            }
        }

        await connection.commit();
        res.json({ success: true, summary, warnings });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error('[uploadCategories] Transaction Error:', err);
        res.status(500).json({ success: false, message: 'Database transaction failed.' });
    } finally {
        if (connection) connection.release();
        // Cleanup temp file
        if (tempCreated && filePath) fs.promises.unlink(filePath).catch(()=>{});
    }
};

module.exports = uploadCategoriesService;
