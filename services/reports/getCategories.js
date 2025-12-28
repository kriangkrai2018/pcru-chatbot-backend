/**
 * Service to get all categories for the logged-in officer.
 * @param {object} pool - MySQL connection pool
 * @returns {function} - Express middleware (req, res)
 */
const getCategoriesService = (pool) => async (req, res) => {
    try {
        const officerId = req.user?.userId;
        if (!officerId) {
            return res.status(401).json({ success: false, message: 'Unauthorized: Could not identify the user from the token.' });
        }
        // ส่งชื่อหมวดหมู่แทนรหัส (CategoriesID จะเป็นชื่อ)
        // If the user is an Officer, return both their categories and global ones (OfficerID IS NULL).
        // If the user is an Admin (or other non-officer), return global categories (OfficerID IS NULL).
        const usertype = req.user?.usertype;
        let rows;
        const order = req.query && String(req.query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        if (usertype === 'Officer') {
            [rows] = await pool.query(
                `SELECT c.CategoriesID, c.CategoriesName, c.OfficerID, c.ParentCategoriesID, c.CategoriesPDF,
                        (SELECT GROUP_CONCAT(Contact SEPARATOR ' ||| ') FROM Categories_Contact cc2 WHERE cc2.CategoriesID = c.CategoriesID) AS Contact
                 FROM Categories c
                 WHERE c.OfficerID = ?
                 ORDER BY c.CategoriesID ${order}`,
                [officerId]
            );
        } else {
            [rows] = await pool.query(
                `SELECT c.CategoriesID, c.CategoriesName, c.OfficerID, c.ParentCategoriesID, c.CategoriesPDF,
                        (SELECT GROUP_CONCAT(Contact SEPARATOR ' ||| ') FROM Categories_Contact cc2 WHERE cc2.CategoriesID = c.CategoriesID) AS Contact
                 FROM Categories c
                 WHERE c.OfficerID IS NULL
                 ORDER BY c.CategoriesID ${order}`
            );
        }
        console.log('[getCategories] fetched', Array.isArray(rows) ? rows.length : 0, 'rows; sample:', (Array.isArray(rows) ? rows.slice(0,5).map(r => ({ CategoriesID: r.CategoriesID, Contact: r.Contact })) : rows));

        // Ensure Contact is populated by fetching grouped contacts and merging (fallback if subquery failed for any reason)
        try {
            const [contactsGrouped] = await pool.query(`SELECT CategoriesID, GROUP_CONCAT(Contact SEPARATOR ' ||| ') AS Contact FROM Categories_Contact GROUP BY CategoriesID`);
            const contactMap = new Map((contactsGrouped || []).map(r => [String(r.CategoriesID), String(r.Contact || '')]));
            // merge into rows
            if (Array.isArray(rows)) {
                rows = rows.map(r => {
                    const key = String(r.CategoriesID);
                    const fromMap = contactMap.has(key) ? contactMap.get(key) : (contactMap.has(key.replace(/\s+$/, '')) ? contactMap.get(key.replace(/\s+$/, '')) : '');
                    // Ensure Contact property exists (empty string if missing)
                    const contactVal = String(r.Contact || '') || fromMap || '';
                    return Object.assign({}, r, { Contact: contactVal });
                });
            }
            // log Category 4 details for verification
            const c4 = Array.isArray(rows) ? rows.find(x => String(x.CategoriesID) === '4') : null;
            if (c4) console.log('[getCategories] Category 4 after merge Contact:', c4.Contact);
        } catch (e) {
            console.warn('[getCategories] failed to merge grouped Contacts:', e && (e.message || e));
        }

        // Ensure Contact is always present as a property in the response objects
        if (Array.isArray(rows)) {
            rows = rows.map(r => ({
                CategoriesID: r.CategoriesID,
                CategoriesName: r.CategoriesName,
                OfficerID: r.OfficerID,
                ParentCategoriesID: r.ParentCategoriesID,
                CategoriesPDF: r.CategoriesPDF,
                Contact: String(r.Contact || '')
            }));
        }

        // Debug: log final sample keys and first object
        try {
            console.log('[getCategories] final sample keys:', Array.isArray(rows) ? rows.slice(0,5).map(r => Object.keys(r)) : rows);
            console.log('[getCategories] sample rows:', Array.isArray(rows) ? rows.slice(0,5) : rows);
        } catch (e) {
            console.warn('[getCategories] failed to log final sample:', e && (e.message || e));
        }

        res.status(200).json({ success: true, categories: rows, count: Array.isArray(rows) ? rows.length : 0 });
    } catch (error) {
        console.error('❌ Error fetching categories:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

module.exports = getCategoriesService;
