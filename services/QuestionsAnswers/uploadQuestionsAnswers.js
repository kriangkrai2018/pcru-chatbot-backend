// services/QuestionsAnswers/uploadQuestionsAnswers.js
// Requires: npm install csv-parser validator
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const validator = require('validator');
const ensureKeyword = require('./ensureKeyword');
const { clearStopwordsCache } = require('../stopwords/loadStopwords');
const cleanupUnusedKeywords = require('./cleanupUnusedKeywords');
const { toIsoDate } = require('./dateUtils');

// ฟังก์ชันสำหรับแยก keyword จาก string (รองรับ , ; และเว้นวรรค)
function parseKeywords(str) {
	if (!str || typeof str !== 'string') return [];
	// แยกด้วย comma, semicolon, หรือเว้นวรรค (รองรับหลายตัวคั่นติดกัน)
	return str
		.split(/[,;\n\r]+|\s{2,}/)
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

// ฟังก์ชัน normalize เพื่อใช้ dedupe keyword แบบไม่แยกตัวพิมพ์ใหญ่/เล็ก และลดช่องว่างซ้ำ
function normalizeKeywordForMatch(s) {
	if (!s) return '';
	try {
		const noAccent = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		return noAccent.replace(/\s+/g, ' ').trim().toLowerCase();
	} catch (_) {
		return String(s).replace(/\s+/g, ' ').trim().toLowerCase();
	}
}

const uploadQuestionsAnswersService = (pool) => async (req, res) => {
	const notifyQuestionsAnswersUpdate = req.app.locals && req.app.locals.notifyQuestionsAnswersUpdate;
	// Debug
	console.log('[uploadQuestionsAnswers] headers:', {
		authorization: req.headers?.authorization,
		'content-type': req.headers?.['content-type'] || req.headers?.['Content-Type']
	});
	console.log('[uploadQuestionsAnswers] req.file:', req.file, 'req.files:', req.files);

	// Get uploader ID early for directory creation
	const uploaderId = req.user?.userId;
	if (!uploaderId) {
		return res.status(401).json({ success: false, message: 'Unauthorized: uploader not identified from token.' });
	}

	// Create user-specific directory (no 'file' subfolder now)
	const userUploadDir = path.join(__dirname, '..', '..', 'files', 'managequestionsanswers', String(uploaderId));
	await fs.promises.mkdir(userUploadDir, { recursive: true });

	// Helper: clear directory (optionally keep one path)
	async function clearUserDir(dir, keepPath = null) {
		try {
			const entries = await fs.promises.readdir(dir);
			for (const entry of entries) {
				const entryPath = path.join(dir, entry);
				try {
					const stat = await fs.promises.stat(entryPath);
					if (stat.isFile()) {
						if (keepPath && path.resolve(entryPath) === path.resolve(keepPath)) {
							// skip deleting the file we plan to keep
							continue;
						}
						await fs.promises.unlink(entryPath).catch(()=>{});
					} else if (stat.isDirectory()) {
						// remove directory recursively
						await fs.promises.rm(entryPath, { recursive: true, force: true }).catch(()=>{});
					}
				} catch(e) {
					// ignore stat/unlink errors per file
				}
			}
		} catch (e) {
			// ignore if directory missing or other issues
		}
	}

	// If multer used upload.any(), pick first file
	if (!req.file && Array.isArray(req.files) && req.files.length > 0) {
		req.file = req.files[0];
		console.log('[uploadQuestionsAnswers] selected req.file from req.files:', req.file.fieldname, req.file.originalname);
	}

	// If file was uploaded via multer to different location, move it to user directory
	let movedFile = false;
	if (req.file && req.file.path) {
		const currentPath = req.file.path;
		const fileName = `upload_questionsanswers_${Date.now()}_${req.file.originalname || 'file.csv'}`;
		const newPath = path.join(userUploadDir, fileName);
		
		// Determine if the current path is already in the target user directory
		const alreadyInUserDir = path.resolve(currentPath).includes(path.resolve(path.join('files','managequestionsanswers', String(uploaderId))));

		// Clear existing files, but keep currentPath if it's already inside userUploadDir
		await clearUserDir(userUploadDir, alreadyInUserDir ? currentPath : null);

		// Move/rename or copy+delete depending on disk
		if (!alreadyInUserDir) {
			try {
				await fs.promises.rename(currentPath, newPath);
				req.file.path = newPath;
				movedFile = true;
				console.log('[uploadQuestionsAnswers] Moved file from', currentPath, 'to', newPath);
			} catch (moveErr) {
				try {
					await fs.promises.copyFile(currentPath, newPath);
					await fs.promises.unlink(currentPath).catch(() => {});
					req.file.path = newPath;
					movedFile = true;
					console.log('[uploadQuestionsAnswers] Copied and moved file to', newPath);
				} catch (copyErr) {
					console.error('[uploadQuestionsAnswers] Failed to move/copy file:', copyErr);
				}
			}
		} else {
			// Already in the correct directory: optionally normalize filename
			if (path.resolve(currentPath) !== path.resolve(newPath)) {
				try {
					await fs.promises.rename(currentPath, newPath);
					req.file.path = newPath;
					console.log('[uploadQuestionsAnswers] Renamed existing file in user dir to', newPath);
				} catch (renameErr) {
					// if rename fails, keep currentPath
					req.file.path = currentPath;
					console.log('[uploadQuestionsAnswers] Keeping existing file path in user dir:', currentPath);
				}
			} else {
				req.file.path = currentPath;
			}
		}
	}

	// Fallback: accept CSV in body under file/csv/etc or raw text
	let createdTempFile = false;
	let tempFilePath = null;
	const bodyFileString = (typeof req.body === 'string' && req.body.length > 0)
		? req.body
		: (req.body && (req.body.file || req.body.csv || req.body.csvFile || req.body.data));

	if (!req.file && bodyFileString && typeof bodyFileString === 'string' && bodyFileString.length > 0) {
		try {
			const fileString = bodyFileString;
			let base64Data = fileString;
			const dataUrlMatch = fileString.match(/^data:(.+);base64,(.*)$/);
			let detectedMime = 'text/csv';
			if (dataUrlMatch) {
				detectedMime = dataUrlMatch[1] || 'text/csv';
				base64Data = dataUrlMatch[2];
			} else {
				const looksLikeBase64 = /^[A-Za-z0-9+/=\s]+$/.test(fileString.replace(/\r?\n/g,''));
				if (!looksLikeBase64) {
					base64Data = Buffer.from(fileString, 'utf8').toString('base64');
					detectedMime = 'text/csv';
				}
			}
			const fileName = `upload_questionsanswers_${Date.now()}.csv`;
			tempFilePath = path.join(userUploadDir, fileName);

			// Remove previous files in the user dir before writing the new one
			await clearUserDir(userUploadDir);

			const buffer = Buffer.from(base64Data, 'base64');
			await fs.promises.writeFile(tempFilePath, buffer);
			req.file = { path: tempFilePath, originalname: fileName, mimetype: detectedMime };
			createdTempFile = true;
			console.log('[uploadQuestionsAnswers] Created temp file from request body:', tempFilePath);
		} catch (err) {
			console.error('[uploadQuestionsAnswers] Failed to create temp file from body:', err);
		}
	}

	if (!req.file) {
		console.error('[uploadQuestionsAnswers] No file found. content-type:', req.headers['content-type']);
		return res.status(400).json({
			success: false,
			message: 'No file uploaded. Send multipart/form-data (file field) or raw CSV (Content-Type: text/csv).'
		});
	}

	const allowedMime = new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv']);
	const originalName = req.file.originalname || '';
	const extIsCsv = originalName.toLowerCase().endsWith('.csv');

	if (!allowedMime.has(req.file.mimetype) && !extIsCsv) {
		fs.promises.unlink(req.file.path).catch(()=>{});
		if (createdTempFile && tempFilePath) fs.promises.unlink(tempFilePath).catch(()=>{});
		return res.status(400).json({ success: false, message: `Invalid file type. Detected mimetype=${req.file.mimetype}` });
	}

	const filePath = req.file.path;
	const rows = [];
	let connection;
	const summary = { totalRows: 0, inserted: 0, updated: 0, failed: 0, deleted: 0, unassigned: 0 };

	// duplicates flags: allowDuplicates (upsert) and allowExactDuplicates (insert duplicates even when titles/texts match)
	const allowDuplicates = (String(req.body?.allowDuplicates || req.query?.allowDuplicates || '').toLowerCase() === 'true') || (req.body?.allowDuplicates === '1') || (req.query?.allowDuplicates === '1');
	let allowExactDuplicates = (String(req.body?.allowExactDuplicates || req.query?.allowExactDuplicates || '').toLowerCase() === 'true') || (req.body?.allowExactDuplicates === '1') || (req.query?.allowExactDuplicates === '1');
	const warnings = []; // non-fatal notices when duplicates-mode enabled

	// Default behavior: if no explicit flag provided and this is a file upload (multipart),
	// treat uploads as duplicates-allowed so users can import exact duplicate rows easily.
	try {
		const bodyHasFlag = !!(req.body && req.body.allowExactDuplicates && String(req.body.allowExactDuplicates).trim() !== '');
		const queryHasFlag = !!(req.query && req.query.allowExactDuplicates && String(req.query.allowExactDuplicates).trim() !== '');
		if (!bodyHasFlag && !queryHasFlag && req.file) {
			allowExactDuplicates = true;
			console.log('[uploadQuestionsAnswers] Defaulting allowExactDuplicates=true for multipart upload (no explicit flag)');
		}
	} catch (e) { /* ignore */ }

	console.log('[uploadQuestionsAnswers] allowDuplicates:', allowDuplicates, 'allowExactDuplicates:', allowExactDuplicates);

	try {
		// Read CSV
		await new Promise((resolve, reject) => {
			fs.createReadStream(filePath)
				.pipe(csv({ 
					bom: true, 
					mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim()
				}))
				.on('data', data => rows.push(data))
				.on('end', resolve)
				.on('error', reject);
		});

		if (!rows || rows.length === 0) {
			try { await fs.promises.unlink(filePath); } catch(e){/*ignore*/ }
			return res.status(400).json({ success: false, message: 'CSV file empty or headers invalid.' });
		}

		// DEBUG: log headers and first row for diagnosis
		if (rows.length > 0) {
			console.log('[uploadQuestionsAnswers] CSV parsed headers:', Object.keys(rows[0]));
			console.log('[uploadQuestionsAnswers] First row sample:', rows[0]);
		}

		// NEW: Inspect CSV for keyword-like columns (CSV diagnostics only — DB keyword handling is removed)
		try {
			const headerKeys = Object.keys(rows[0] || {}).map(k => String(k).trim());
			const candidateCols = ['KeywordText', 'Keywords', 'Keyword', 'KeywordsList'];
			const keywordCol = candidateCols.find(c => headerKeys.includes(c)) || null;
			if (keywordCol) {
				let nonEmpty = 0;
				let sample = '';
				for (const r of rows) {
					const v = r[keywordCol];
					if (v && String(v).trim().length > 0) {
						nonEmpty++;
						if (!sample) sample = String(v).trim().slice(0, 120);
					}
				}
				console.log(`[uploadQuestionsAnswers] CSV keyword column detected: "${keywordCol}" — non-empty rows: ${nonEmpty}${sample ? `, sample="${sample}"` : ''}`);
			} else {
				console.log('[uploadQuestionsAnswers] CSV has no keyword column among: KeywordText, Keywords, Keyword, KeywordsList');
			}
		} catch (diagErr) {
			console.warn('[uploadQuestionsAnswers] CSV keyword diagnostics failed:', diagErr?.message || diagErr);
		}

		// Reorder: process rows that specify numeric QuestionsAnswersID first (ascending),
		// then the rows without an ID in original order — this follows DB-specified IDs.
		try {
			const rowsWithId = [];
			const rowsWithoutId = [];
			for (const r of rows) {
				const idRaw = r.QuestionsAnswersID ? String(r.QuestionsAnswersID).trim() : '';
				if (/^\d+$/.test(idRaw)) rowsWithId.push(r);
				else rowsWithoutId.push(r);
			}
			rowsWithId.sort((a, b) => Number(a.QuestionsAnswersID) - Number(b.QuestionsAnswersID));
			// replace rows array with ordered rows
			rows.length = 0;
			rows.push(...rowsWithId, ...rowsWithoutId);
			console.log('[uploadQuestionsAnswers] Reordered rows: with-ID first (count:', rowsWithId.length, '), without-ID:', rowsWithoutId.length, ')');
		} catch (e) {
			console.warn('[uploadQuestionsAnswers] Could not reorder rows:', e.message || e);
		}

		// ------------------- new: detect exact duplicates within CSV and alert -------------------
		try {
			const trimVal = v => (v || '').toString().trim();
			const exactConflicts = [];

			for (let i = 0; i < rows.length; i++) {
				const aTitleRaw = trimVal(rows[i].QuestionTitle);
				const aTextRaw = trimVal(rows[i].QuestionText);
				if (!aTitleRaw && !aTextRaw) continue;

				for (let j = i + 1; j < rows.length; j++) {
					const bTitleRaw = trimVal(rows[j].QuestionTitle);
					const bTextRaw = trimVal(rows[j].QuestionText);

					if (aTitleRaw && bTitleRaw && aTitleRaw === bTitleRaw) {
						exactConflicts.push({
							type: 'exact-duplicate',
							field: 'QuestionTitle',
							rowA: i + 2,
							rowB: j + 2,
							value: aTitleRaw,
							description: `Exact duplicate in QuestionTitle at rows ${i + 2} and ${j + 2}: "${aTitleRaw}"`
						});
					}
					if (aTextRaw && bTextRaw && aTextRaw === bTextRaw) {
						exactConflicts.push({
							type: 'exact-duplicate',
							field: 'QuestionText',
							rowA: i + 2,
							rowB: j + 2,
							value: aTextRaw,
							description: `Exact duplicate in QuestionText at rows ${i + 2} and ${j + 2}: "${aTextRaw}"`
						});
					}
				}
			}

			if (exactConflicts.length > 0) {
				// If duplicates mode enabled, convert exact duplicates to warnings and continue; otherwise abort
				if (allowExactDuplicates || allowDuplicates) {
					warnings.push(...exactConflicts.map(c => ({ ...c, severity: 'warning' })));
					console.warn('[uploadQuestionsAnswers] Exact duplicates detected but duplicates-mode enabled; converting to warnings:', exactConflicts.length);
				} else {
					console.warn('[uploadQuestionsAnswers] Exact duplicate rows detected in CSV, aborting import. Conflicts:', exactConflicts);
					if (createdTempFile && tempFilePath) {
						fs.promises.unlink(tempFilePath).catch(()=>{});
					}
					return res.status(400).json({
						success: false,
						errorType: 'exact_duplicate',
						message: 'Exact duplicate rows detected in uploaded CSV. Please review the highlighted rows/columns before importing.',
						conflictsCount: exactConflicts.length,
						conflicts: exactConflicts
					});
				}
			}
		} catch (scanErr) {
			console.warn('[uploadQuestionsAnswers] exact-duplicate scan failed, continuing to fuzzy checks:', scanErr.message || scanErr);
		}
		// ------------------- end exact-duplicate block -------------------

		// ------------------- existing fuzzy similarity detection follows -------------------
		try {
			// normalize text: remove diacritics, punctuation, collapse whitespace
			const normalize = (s = '') => {
				const noAccent = s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
				return noAccent
					.replace(/[^\p{L}\p{N}\s]/gu, '') // remove punctuation
					.replace(/\s+/g, ' ')
					.trim()
					.toLowerCase();
			};

			// Levenshtein distance
			const levenshtein = (a = '', b = '') => {
				const m = a.length, n = b.length;
				if (m === 0) return n;
				if (n === 0) return m;
				const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
				for (let i = 0; i <= m; i++) dp[i][0] = i;
				for (let j = 0; j <= n; j++) dp[0][j] = j;
				for (let i = 1; i <= m; i++) {
					for (let j = 1; j <= n; j++) {
						const cost = a[i - 1] === b[j - 1] ? 0 : 1;
						dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost);
					}
				}
				return dp[m][n];
			};

			const alerts = [];
			const threshold = 0.8; // similarity threshold

			for (let i = 0; i < rows.length; i++) {
				const aTitle = normalize(rows[i].QuestionTitle || '');
				const aText = normalize(rows[i].QuestionText || '');
				// skip empty normalized fields
				if (!aTitle && !aText) continue;

				for (let j = i + 1; j < rows.length; j++) {
					const bTitle = normalize(rows[j].QuestionTitle || '');
					const bText = normalize(rows[j].QuestionText || '');
					if (!bTitle && !bText) continue;

					// check title similarity
					if (aTitle && bTitle) {
						const maxLen = Math.max(aTitle.length, bTitle.length) || 1;
						const dist = levenshtein(aTitle, bTitle);
						const sim = 1 - (dist / maxLen);
						// substring strong match also counts
						const substringMatch = aTitle.includes(bTitle) || bTitle.includes(aTitle);

						// skip alert when strings are identical after removing all digits (treat "text1" vs "text2" as distinct if you WANT
						// to ignore numeric-only differences; here we *skip* alert when they only differ by digits)
						const stripDigits = s => (s || '').replace(/\p{N}+/gu, '').trim();
						if (stripDigits(aTitle) === stripDigits(bTitle)) {
							// they differ only by digits (or are identical after removing digits) -> treat as non-duplicate, skip
						} else if (sim >= threshold || substringMatch) {
							alerts.push({
								type: 'title-similar',
								rowA: i + 2,
								rowB: j + 2,
								field: 'QuestionTitle',
								valueA: rows[i].QuestionTitle,
								valueB: rows[j].QuestionTitle,
								similarity: +(sim.toFixed(3)),
								substringMatch: !!substringMatch
							});
							continue;
						}
					}

					// check text similarity
					if (aText && bText) {
						const maxLen = Math.max(aText.length, bText.length) || 1;
						const dist = levenshtein(aText, bText);
						const sim = 1 - (dist / maxLen);
						const substringMatch = aText.includes(bText) || bText.includes(aText);

						// same digit-stripping logic for QuestionText
						const stripDigits = s => (s || '').replace(/\p{N}+/gu, '').trim();
						if (stripDigits(aText) === stripDigits(bText)) {
							// differ only by digits -> skip
						} else if (sim >= threshold || substringMatch) {
							alerts.push({
								type: 'text-similar',
								rowA: i + 2,
								rowB: j + 2,
								field: 'QuestionText',
								valueA: rows[i].QuestionText,
								valueB: rows[j].QuestionText,
								similarity: +(sim.toFixed(3)),
								substringMatch: !!substringMatch
							});
						}
					}
				}
			}

			if (alerts.length > 0) {
				// Build human-friendly descriptions for each alert
				const conflicts = alerts.map(a => {
					const desc = a.type === 'title-similar'
						? `Row ${a.rowA} and Row ${a.rowB} have similar QuestionTitle: "${a.valueA}" <> "${a.valueB}" (similarity=${a.similarity}${a.substringMatch ? ', substring match' : ''})`
						: `Row ${a.rowA} and Row ${a.rowB} have similar QuestionText: "${a.valueA}" <> "${a.valueB}" (similarity=${a.similarity}${a.substringMatch ? ', substring match' : ''})`;
					return {
						...a,
						description: desc
					};
				});

				// If duplicates-mode enabled, convert these to warnings and continue; otherwise abort and return detailed conflict UI
				if (allowExactDuplicates || allowDuplicates) {
					warnings.push(...conflicts.map(c => ({ ...c, severity: 'warning' })));
					console.warn('[uploadQuestionsAnswers] Similar rows detected but duplicates-mode enabled; converted to warnings, continuing import. Conflicts:', conflicts.length);
				} else {
					console.warn('[uploadQuestionsAnswers] Similar rows detected in CSV, aborting import. Conflicts:', conflicts);
					// cleanup temp file if created
					if (createdTempFile && tempFilePath) {
						fs.promises.unlink(tempFilePath).catch(()=>{});
					}

					// Attach rowsDetail to each conflict for UI highlighting
					const conflictsWithDetails = conflicts.map(a => {
						const rowA = rows[a.rowA - 2] || {}; // convert back to zero-based index used earlier
						const rowB = rows[a.rowB - 2] || {};
						return {
							...a,
							rowsDetail: [
								{ rowNum: a.rowA, QuestionTitle: rowA.QuestionTitle, QuestionText: rowA.QuestionText, CategoriesID: rowA.CategoriesID },
								{ rowNum: a.rowB, QuestionTitle: rowB.QuestionTitle, QuestionText: rowB.QuestionText, CategoriesID: rowB.CategoriesID }
							]
						};
					});

					// Build UI hint (large modal) for frontend
					const highlightRows = Array.from(new Set(conflictsWithDetails.flatMap(c => (c.rows || [])))).sort((a,b)=>a-b);

					// Return structured, detailed response
					return res.status(400).json({
						success: false,
						errorType: 'duplicate_data',
						message: 'พบแถวที่ซ้ำหรือมีความคล้ายคลึงกันในไฟล์ CSV ที่อัปโหลด กรุณาตรวจสอบแถว/คอลัมน์ที่ถูกเน้นก่อนนำเข้า',
						message_th: 'พบแถวที่ซ้ำหรือมีความคล้ายคลึงกันในไฟล์ CSV ที่อัปโหลด กรุณาตรวจสอบแถว/คอลัมน์ที่ถูกเน้นก่อนนำเข้า',
						message_en: 'Duplicate or very similar rows detected in uploaded CSV. Please review the highlighted rows/columns before importing.',
						conflictsCount: conflictsWithDetails.length,
						conflicts: conflictsWithDetails,
						ui: {
							title: 'อัปโหลดล้มเหลว: พบแถวที่ซ้ำ/คล้าย',
							description: 'รายการด้านล่างแสดงแถวและคอลัมน์ที่ซ้ำหรือคล้ายกัน กรุณาตรวจสอบและแก้ไขก่อนนำเข้า',
							size: 'large',
							severity: 'error',
							highlightRows
						}
					});
				}
			}
		} catch (scanErr) {
			console.warn('[uploadQuestionsAnswers] similarity scan failed, continuing import:', scanErr.message || scanErr);
			// fallback: continue processing if scanner fails
		}
		// ------------------- end fuzzy block -------------------

		summary.totalRows = rows.length;

		connection = await pool.getConnection();
		await connection.beginTransaction();

		const uploaderId = (req.user?.userId ?? req.user?.officerId);
		if (!uploaderId) {
			await connection.release();
			return res.status(401).json({ success: false, message: 'Unauthorized: uploader not identified from token.' });
		}

		// Determine OfficerID to use for inserted QAs: if uploader is an Officer use their ID, otherwise set NULL for Admins
		const ownerOfficerId = (req.user && req.user.usertype === 'Officer') ? uploaderId : null;

		if (ownerOfficerId !== null) {
			const [officerCheck] = await connection.query('SELECT 1 FROM Officers WHERE OfficerID = ? LIMIT 1', [ownerOfficerId]);
			if (!officerCheck || officerCheck.length === 0) {
				console.warn(`[uploadQuestionsAnswers] uploaderId ${ownerOfficerId} not found in Officers table, setting to NULL`);
				ownerOfficerId = null;
			}
		}

		// Attempt to determine a numeric next ID in case QuestionsAnswersID is NOT auto-increment.
		// This will be used when CSV rows do not provide an ID but the DB requires one.
		let nextQaId = null;
		try {
			const [maxRows] = await connection.query('SELECT MAX(QuestionsAnswersID) AS maxId FROM QuestionsAnswers');
			const maxId = (maxRows && maxRows[0] && maxRows[0].maxId) ? Number(maxRows[0].maxId) : 0;
			nextQaId = maxId + 1;
		} catch (e) {
			// If table missing or query fails, fall back to timestamp-based numeric ids
			nextQaId = Math.floor(Date.now() / 1000);
			console.warn('[uploadQuestionsAnswers] Could not determine max QuestionsAnswersID, using fallback nextQaId:', nextQaId, e.message || e);
		}

		// track QuestionsAnswers IDs we inserted/updated from CSV
		const processedQaIds = new Set();
		for (let i = 0; i < rows.length; i++) {
			try {
				const r = rows[i];

				// Helper: get field value from multiple possible header names (case-insensitive + Thai aliases)
				const getField = (obj, names) => {
					// Normalize target names for matching
					const normNames = names.map(n => n.toLowerCase().replace(/\s+/g, ''));
					for (const [key, val] of Object.entries(obj)) {
						const normKey = key.toLowerCase().replace(/\s+/g, '');
						if (normNames.includes(normKey) && typeof val !== 'undefined' && String(val).trim().length > 0) {
							return String(val).trim();
						}
					}
					return '';
				};

				const rowNum = i + 2; // CSV header row considered row 1
				const QuestionsAnswersIDraw = getField(r, ['QuestionsAnswersID','questionsanswersid','ID','Id']);
				const QuestionTitle = getField(r, ['QuestionTitle','questiontitle','QUESTIONTITLE','หัวข้อ','คำถาม','Question']);
				const QuestionText = getField(r, ['QuestionText','questiontext','QUESTIONTEXT','คำตอบ','รายละเอียด','Answer','Text']);
				const ReviewDateRaw = getField(r, ['ReviewDate','reviewdate','REVIEWDATE','วันที่ทบทวน','Review']);
				let CategoriesID = getField(r, ['CategoriesID','categoriesid','CATEGORYID','CategoryID','หมวดหมู่','Categories','Category']);

				// ถ้าเป็นแถวว่างจริง ๆ (ทุกคอลัมน์ว่าง) ให้ข้ามโดยไม่ถือเป็น error
				const isCompletelyEmptyRow = Object.values(r).every(v => String(v ?? '').trim() === '');
				if (isCompletelyEmptyRow) {
					console.log(`[uploadQuestionsAnswers] Skipping empty row ${rowNum}`);
					summary.totalRows--; // ไม่นับแถวว่างเป็นข้อมูล
					continue;
				}

				// 🆕 Clean Excel formula format: ="1-1" → 1-1, ="1" → 1
				// Excel sometimes exports as ="value" to preserve text format
				if (CategoriesID) {
					// Remove ="..." wrapper
					const excelFormulaMatch = CategoriesID.match(/^="?([^"]*)"?$/);
					if (excelFormulaMatch) {
						CategoriesID = excelFormulaMatch[1];
						console.log(`[uploadQuestionsAnswers] row ${rowNum}: Cleaned CategoriesID from Excel formula format: "${r.CategoriesID}" → "${CategoriesID}"`);
					}
				}

				// validation
				if (!QuestionTitle) throw new Error(`Error on row ${rowNum}: QuestionTitle is required.`);
				if (!QuestionText) throw new Error(`Error on row ${rowNum}: QuestionText is required.`);

								// Normalize CategoriesID when Excel auto-formats to Thai month names (e.g., 1-ม.ค.)
								if (CategoriesID) {
									const thaiMonths = {
										'ม.ค.': '1', 'ก.พ.': '2', 'มี.ค.': '3', 'เม.ย.': '4', 'พ.ค.': '5', 'มิ.ย.': '6',
										'ก.ค.': '7', 'ส.ค.': '8', 'ก.ย.': '9', 'ต.ค.': '10', 'พ.ย.': '11', 'ธ.ค.': '12'
									};
									const monthMatch = CategoriesID.match(/^(\d+)\-([ก-๙\.]+)$/);
									if (monthMatch && thaiMonths[monthMatch[2]]) {
										CategoriesID = `${monthMatch[1]}-${thaiMonths[monthMatch[2]]}`;
									}
								}

								// 🆕 Map category name to ID if it's not already an ID
								if (CategoriesID && !/^\d{1,2}-\d{1,2}$/.test(CategoriesID)) {
									// It's likely a category name, try to find the ID
									try {
										const [categoryRows] = await connection.query('SELECT CategoriesID FROM Categories WHERE CategoriesName = ? LIMIT 1', [CategoriesID.trim()]);
										if (categoryRows.length > 0) {
											CategoriesID = categoryRows[0].CategoriesID;
											console.log(`[uploadQuestionsAnswers] row ${rowNum}: Mapped category name "${r.CategoriesID}" to ID "${CategoriesID}"`);
										} else {
											console.warn(`[uploadQuestionsAnswers] row ${rowNum}: Category name "${CategoriesID}" not found in database, keeping as is`);
										}
									} catch (err) {
										console.error(`[uploadQuestionsAnswers] row ${rowNum}: Error mapping category name to ID:`, err.message);
									}
								}
				let ReviewDate = toIsoDate(ReviewDateRaw);
				if (!ReviewDate) {
					ReviewDate = new Date().toISOString().slice(0,10);
					console.log(`[uploadQuestionsAnswers] row ${rowNum}: ReviewDate missing/invalid, set to ${ReviewDate}`);
				}

				// Decide insert vs update
				let qaId = null;
				// Helper: find existing QA by title or text
				const findByTitleOrText = async (title, text) => {
					try {
						const [found] = await connection.query(
							'SELECT QuestionsAnswersID FROM QuestionsAnswers WHERE QuestionTitle = ? OR QuestionText = ? LIMIT 1',
							[title, text]
						);
						return (found && found.length > 0) ? found[0].QuestionsAnswersID : null;
					} catch (e) {
						return null;
					}
				};

				if (QuestionsAnswersIDraw && /^\d+$/.test(QuestionsAnswersIDraw)) {
					const providedId = Number(QuestionsAnswersIDraw);
					// If the provided ID exists, update it
					const [existsById] = await connection.query(
						'SELECT QuestionsAnswersID FROM QuestionsAnswers WHERE QuestionsAnswersID = ? LIMIT 1',
						[providedId]
					);
					if (existsById && existsById.length > 0) {
						qaId = providedId;
						await connection.query(
							'UPDATE QuestionsAnswers SET ReviewDate = ?, QuestionTitle = ?, QuestionText = ?, CategoriesID = ?, OfficerID = ? WHERE QuestionsAnswersID = ?',
					[ReviewDate, QuestionTitle, QuestionText, CategoriesID, ownerOfficerId, qaId]
						);
						summary.updated++;
					} else {
						// If not by ID, check duplicates by title/text and overwrite those
						const dupId = await findByTitleOrText(QuestionTitle, QuestionText);
						if (dupId) {
							qaId = dupId;
							await connection.query(
								'UPDATE QuestionsAnswers SET ReviewDate = ?, QuestionTitle = ?, QuestionText = ?, CategoriesID = ?, OfficerID = ? WHERE QuestionsAnswersID = ?',
								[ReviewDate, QuestionTitle, QuestionText, CategoriesID, uploaderId, qaId]
							);
							summary.updated++;
						} else {
							// Safe to insert with provided ID
							await connection.query(
								'INSERT INTO QuestionsAnswers (QuestionsAnswersID, ReviewDate, QuestionTitle, QuestionText, CategoriesID, OfficerID) VALUES (?, ?, ?, ?, ?, ?)',
						[providedId, ReviewDate, QuestionTitle, QuestionText, CategoriesID, ownerOfficerId]
							);
							qaId = providedId;
							summary.inserted++;
							if (typeof nextQaId === 'number' && providedId >= nextQaId) nextQaId = providedId + 1;
						}
					}
				} else {
					// No provided ID: check duplicate by title/text first and update if found
					const dupId = await findByTitleOrText(QuestionTitle, QuestionText);
					if (dupId) {
						qaId = dupId;
						await connection.query(
							'UPDATE QuestionsAnswers SET ReviewDate = ?, QuestionTitle = ?, QuestionText = ?, CategoriesID = ?, OfficerID = ? WHERE QuestionsAnswersID = ?',
						[ReviewDate, QuestionTitle, QuestionText, CategoriesID, ownerOfficerId, qaId]
						);
						summary.updated++;
					} else {
						// Insert new record using generated ID (if DB requires explicit ID)
						const genId = nextQaId;
						nextQaId = (typeof nextQaId === 'number') ? nextQaId + 1 : genId + 1;
						await connection.query(
							'INSERT INTO QuestionsAnswers (QuestionsAnswersID, ReviewDate, QuestionTitle, QuestionText, CategoriesID, OfficerID) VALUES (?, ?, ?, ?, ?, ?)',
						[genId, ReviewDate, QuestionTitle, QuestionText, CategoriesID, ownerOfficerId]
						);
						qaId = genId;
						summary.inserted++;
					}
				}

				// record processed QA id (string) for later cleanup
				try { processedQaIds.add(String(qaId)); } catch(e){/*ignore*/}

				// NEW: keywords handling (always ensure keywords exist in DB, then map)
			// Reconstruct keywords across adjacent columns when CSV fields are not quoted and commas split into extra columns (_4, _5, ...)
			let keywordsParts = [];
			const kwMain = r.KeywordText || r.Keywords || r.Keyword || r.KeywordsList || '';
			if (kwMain && String(kwMain).trim() !== '') keywordsParts.push(String(kwMain).trim());
			for (const [k, v] of Object.entries(r)) {
				if (/^_\d+$/.test(k) && v && String(v).trim() !== '') keywordsParts.push(String(v).trim());
			}
			const keywordsString = keywordsParts.join(',');
			const kws = parseKeywords(keywordsString);
			// dedupe ภายในแถวเดียวกันแบบ case/space-insensitive เพื่อลดการ insert ซ้ำ
			const seenKw = new Set();
			const uniqueKws = [];
			for (const kw of kws) {
				const norm = normalizeKeywordForMatch(kw);
				if (!norm || seenKw.has(norm)) continue;
				seenKw.add(norm);
				uniqueKws.push(kw);
			}

				// delete existing mappings for this QA, then recreate
				try { await connection.query('DELETE FROM AnswersKeywords WHERE QuestionsAnswersID = ?', [qaId]); } catch (_) {}

				for (const kw of uniqueKws) {
					try {
						const kwRes = await ensureKeyword(connection, kw, uploaderId);
						const keywordId = kwRes && kwRes.keywordId ? kwRes.keywordId : null;
						const created = kwRes && kwRes.created ? kwRes.created : false;
						if (keywordId) {
							console.log('[uploadQuestionsAnswers] Inserting AnswersKeywords mapping:', qaId, { keywordId, created });
							try {
								await connection.query(
									'INSERT INTO AnswersKeywords (QuestionsAnswersID, KeywordID) VALUES (?, ?)',
								[qaId, keywordId]
							);
						} catch (e) { console.warn('[uploadQuestionsAnswers] Insert AnswersKeywords failed:', e && e.message ? e.message : e); }
					}
				} catch (e) {
					console.warn('[uploadQuestionsAnswers] ensureKeyword failed for', kw, e && e.message ? e.message : e);
				}
				}
				// These will run in background after commit
			} catch (rowErr) {
				console.error(`[uploadQuestionsAnswers] Row ${i + 2} failed:`, rowErr.message || rowErr);
				// If a row failed to insert/update, still attempt to ensure keywords from the CSV exist in Keywords table
				try {
					const rowObj = rows[i] || {};
				// Reconstruct keywords across adjacent _N columns if CSV didn't quote fields properly
				let kwParts = [];
				const kwMain2 = rowObj.KeywordText || rowObj.Keywords || rowObj.Keyword || rowObj.KeywordsList || '';
				if (kwMain2 && String(kwMain2).trim() !== '') kwParts.push(String(kwMain2).trim());
				for (const [k, v] of Object.entries(rowObj)) {
					if (/^_\d+$/.test(k) && v && String(v).trim() !== '') kwParts.push(String(v).trim());
				}
				const kws = parseKeywords(kwParts.join(',') || '');
					const seenKw = new Set();
					let createdKws = 0;
					for (const kw of kws) {
						const norm = normalizeKeywordForMatch(kw);
						if (!norm || seenKw.has(norm)) continue;
						seenKw.add(norm);
						try {
							const kwRes = await ensureKeyword(connection, kw, uploaderId);
						const keywordId = kwRes && kwRes.keywordId ? kwRes.keywordId : null;
							if (keywordId) createdKws++;
						} catch (e) {
							// ignore individual keyword errors
						}
					}
					if (createdKws > 0) {
						warnings.push({ type: 'keywords-created', row: i + 2, created: createdKws, message: 'Keywords created for failed row' });
						console.log('[uploadQuestionsAnswers] Created', createdKws, 'keywords for failed row', i + 2);
					}
				} catch (kwErr) {
					console.warn('[uploadQuestionsAnswers] Keyword creation for failed row failed:', kwErr && kwErr.message ? kwErr.message : kwErr);
				}
				summary.failed++;
				continue;
			}
		}

		// Remove QuestionsAnswers for this uploader that are NOT present in the uploaded CSV
		try {
			console.log('[uploadQuestionsAnswers] Checking for QAs to delete...');
			console.log('[uploadQuestionsAnswers] uploaderId:', uploaderId);
			console.log('[uploadQuestionsAnswers] processedQaIds:', [...processedQaIds]);
			
			const [existingRows] = await connection.query('SELECT QuestionsAnswersID FROM QuestionsAnswers WHERE OfficerID = ?', [uploaderId]);
			const existingIds = (existingRows || []).map(r => String(r.QuestionsAnswersID));
			console.log('[uploadQuestionsAnswers] existingIds for this officer:', existingIds);
			
			const toRemove = existingIds.filter(id => !processedQaIds.has(id));
			console.log('[uploadQuestionsAnswers] toRemove:', toRemove);
			
			if (toRemove.length > 0) {
				try {
					// Get ChatLogIDs that reference these QAs
					const [chatLogs] = await connection.query(
						'SELECT ChatLogID FROM ChatLogHasAnswers WHERE QuestionsAnswersID IN (?)', 
						[toRemove]
					);
					const chatLogIds = chatLogs.map(r => r.ChatLogID);
					
					// 1. Delete feedbacks that reference these chat logs (FK: feedbacks → chatloghasanswers)
					if (chatLogIds.length > 0) {
						await connection.query('DELETE FROM Feedbacks WHERE ChatLogID IN (?)', [chatLogIds]);
						console.log('[uploadQuestionsAnswers] Deleted Feedbacks for', chatLogIds.length, 'chat logs');
					}
					
					// 2. Delete chat log references (FK: chatloghasanswers → questionsanswers)
					await connection.query('DELETE FROM ChatLogHasAnswers WHERE QuestionsAnswersID IN (?)', [toRemove]);
					console.log('[uploadQuestionsAnswers] Deleted ChatLogHasAnswers references');
					
					// 3. Delete keyword mappings
					await connection.query('DELETE FROM AnswersKeywords WHERE QuestionsAnswersID IN (?)', [toRemove]);
					console.log('[uploadQuestionsAnswers] Deleted AnswersKeywords');
					
					// 4. Now delete QA rows
					const [delRes] = await connection.query('DELETE FROM QuestionsAnswers WHERE QuestionsAnswersID IN (?)', [toRemove]);
					summary.deleted = typeof delRes.affectedRows === 'number' ? delRes.affectedRows : toRemove.length;
					summary.unassigned = 0;
					console.log('[uploadQuestionsAnswers] Deleted', summary.deleted, 'QA rows');
				} catch (delErr) {
					console.error('[uploadQuestionsAnswers] delete failed:', delErr.message || delErr);
					summary.deleted = 0;
					summary.unassigned = 0;
				}
			}
		} catch (cleanupErr) {
			console.warn('[uploadQuestionsAnswers] cleanup of existing QuestionsAnswers failed:', cleanupErr.message || cleanupErr);
		}

		// 🆕 Clean up orphaned keywords before commit
		try {
			if (req.file) {
				// If this was a file upload, do not purge orphaned keywords created during import —
				// users expect keywords from CSV to persist even if QA rows failed to insert.
				console.log('[uploadQuestionsAnswers] Skipping orphaned keywords cleanup for file upload to preserve user-provided keywords');
			} else {
				const cleanupResult = await cleanupUnusedKeywords(connection);
				if (cleanupResult.deletedCount > 0) {
					console.log(`🧹 Cleaned up ${cleanupResult.deletedCount} orphaned keywords after upload`);
				}
			}
		} catch (cleanupErr) {
			console.warn('[uploadQuestionsAnswers] keyword cleanup failed (non-fatal):', cleanupErr.message || cleanupErr);
		}

		// commit all changes (inserts/updates and deletions) as one transaction
		await connection.commit();

		// archive uploaded file: clear target dir then copy
		try {
			if (uploaderId) {
				const targetDir = path.join(__dirname, '..', '..', 'files', 'managequestionsanswers', String(uploaderId));
				await fs.promises.mkdir(targetDir, { recursive: true });

				// clear existing files in targetDir
				try {
					const entries = await fs.promises.readdir(targetDir);
					for (const entry of entries) {
						const entryPath = path.join(targetDir, entry);
						await fs.promises.rm(entryPath, { recursive: true, force: true }).catch(()=>{});
					}
				} catch(e){/* ignore */ }

				const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
				const targetFile = path.join(targetDir, `questionsanswers_${timestamp}.csv`);
				await fs.promises.copyFile(filePath, targetFile);
			}
		} catch (copyErr) {
			console.error('[uploadQuestionsAnswers] Failed to archive uploaded file:', copyErr);
		}

		// ปล่อย connection เมื่อทำงานสำเร็จ
		try { await connection.release(); } catch (e) { /* ignore */ }

		// 🔄 Auto-export CSV after successful upload
		try {
			const { autoExportQuestionsAnswersCSV } = require('./autoExportCSV');
			await autoExportQuestionsAnswersCSV(pool, uploaderId);
			console.log('✅ Auto-exported CSV after upload');
		} catch (exportErr) {
			console.error('⚠️  Auto-export failed (non-fatal):', exportErr);
			// Don't fail the request if export fails
		}

				// Broadcast realtime update to /ws/questions-answers
				if (notifyQuestionsAnswersUpdate) {
					notifyQuestionsAnswersUpdate({ action: 'uploaded', summary });
				}

				// Clear stopwords cache when keywords may have been added
				clearStopwordsCache();

				const response = { success: true, summary };
				if (warnings && warnings.length > 0) response.warnings = warnings;
				if (allowDuplicates || allowExactDuplicates) {
					response.message = 'การอัปโหลดเสร็จสมบูรณ์แล้ว (อนุญาตให้มีรายการซ้ำ — บางแถวถูกสำรองเป็นคำเตือน)';
					response.message_th = response.message;
					response.message_en = 'Upload completed (duplicates allowed — some rows are flagged as warnings).';
				}
				res.json(response);
	} catch (err) {
		console.error('[uploadQuestionsAnswers] Unexpected error:', err);
		if (connection) {
			try { await connection.rollback(); } catch(e){}
			finally { await connection.release(); }
		}
		res.status(500).json({
			success: false,
			message: 'Internal server error.',
			error: err.message || String(err)
		});
	} finally {
		if (createdTempFile && tempFilePath) {
			fs.promises.unlink(tempFilePath).catch(()=>{});
		}
		// remove uploaded temp (multer) file if still present
		try { await fs.promises.access(filePath); await fs.promises.unlink(filePath); } catch(e) { /* ignore */ }
	};
};

module.exports = uploadQuestionsAnswersService;
