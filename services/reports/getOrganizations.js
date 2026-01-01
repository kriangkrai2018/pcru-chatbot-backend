// services/reports/getOrganizations.js

const getOrganizationsService = (pool) => {
    return async (req, res) => {
        try {
            // default to DESC, allow ?order=asc for ascending
            const order = req.query && String(req.query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
            const [rows] = await pool.query(
                `SELECT org.OrgID, org.OrgName, org.OrgDescription, org.AdminUserID,
                        COUNT(off.OfficerID) AS StaffCount
                 FROM Organizations org
                 LEFT JOIN Officers off ON off.OrgID = org.OrgID
                 GROUP BY org.OrgID, org.OrgName, org.OrgDescription, org.AdminUserID
                 ORDER BY org.OrgName ${order}`
            );
            res.status(200).json(rows);
        } catch (error) {
            console.error('❌ Error fetching organizations:', error);
            res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    };
};

module.exports = getOrganizationsService;