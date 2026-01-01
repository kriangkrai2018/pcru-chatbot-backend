// services/login.js
// Requires: npm install jsonwebtoken
const jwt = require('jsonwebtoken');

// *** Define Your Secret Key ***
// Should be fetched from environment variables for maximum security
// IMPORTANT: This JWT_SECRET is a server-side only secret.
// It is NEVER sent to the frontend/client. It is used on the server to *sign* the token.
const JWT_SECRET = process.env.JWT_SECRET; 

if (!JWT_SECRET) {
    console.error('ERROR: JWT_SECRET environment variable is not defined. Please set it for security.');
    process.exit(1); // Exit the application if the secret is not set
}

/**
 * Function to handle login and verify users in the database.
 * Uses Stored Procedure: sp_login_check
 * @param {object} pool - An established MySQL Connection Pool
 * @returns {function} - Express Middleware (req, res)
 */
const loginService = (pool, transporter) => async (req, res) => {
    
    // Get id and password from the request body
    const { id, password } = req.body;
    
    console.log(`Login attempt: ID=${id}`); 
    
    try {
        // 1. Use pool.query to call the Stored Procedure
        const [results] = await pool.query(
            'CALL sp_login_check(?, ?)', 
            [id, password] // Pass ID and Password as parameters
        );

        // The result of the Stored Procedure will be in results[0]
        const login_info = results[0]; 
        
        // 2. Check the result from the Stored Procedure
        // usertype = 0 means the user was not found in the AdminUsers or Officer table
        if (!login_info || login_info.length === 0 || login_info[0].usertype === 0) {
            console.log('Access Denied: Invalid ID or Password');

            // --- Send Alert Email ---
            const mailOptions = {
                from: `"PCRU Chatbot" <${process.env.EMAIL_USER}>`,
                to: process.env.EMAIL_USER, // Send to admin
                subject: 'แจ้งเตือน: มีการพยายามเข้าสู่ระบบไม่สำเร็จ',
                html: `
                    <p>เรียนผู้ดูแลระบบ</p>
                    <p>มีการพยายามเข้าสู่ระบบไม่สำเร็จในระบบ PCRU Chatbot Backend</p>
                    <ul>
                        <li><b>ID ที่พยายามใช้:</b> ${id}</li>
                        <li><b>IP Address:</b> ${req.ip}</li>
                        <li><b>เวลา:</b> ${new Date().toISOString()}</li>
                    </ul>
                    <p>โปรดตรวจสอบหากท่านไม่คุ้นเคยกับกิจกรรมนี้</p>
                `
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    return console.error('Error sending failed login alert email:', error);
                }
                console.log('Failed login alert email sent: %s', info.messageId);
            });
            // --- End of Alert Email ---

            return res.status(401).json({ 
                success: false, 
                message: 'Invalid ID or Password!' 
            });
        }
        
        // 3. If user is found: Login successful
        const user = login_info[0];
        const usertype = user.usertype; // <-- Get usertype (1, 2, or 3) determined by the SP

        let userId, userName;

        // ตรวจสอบ usertype เพื่อกำหนด userId และ userName ให้ถูกต้อง
        if (usertype === "Super Admin" || usertype === "Admin") { // Super Admin or Admin
            userId = user.AdminUserID;
            userName = user.AdminName;
        } else if (usertype === "Officer") { // Officer
            // คอลัมน์สำหรับ Officer คือ OfficerID และ OfficerName
            userId = user.OfficerID;
            userName = user.OfficerName;
        }

        // ตรวจสอบว่าได้ ID มาจริง ๆ ก่อนสร้าง Token
        if (!userId) {
            console.error('Login Error: Could not determine user ID from database response for usertype', usertype);
            return res.status(500).json({ success: false, message: 'Internal Server Error: User data inconsistency.' });
        }
        
        console.log(`Login Successful for user: ${userName} (ID: ${userId}), Role: ${usertype}`);
        
        // Before creating token, enrich user object with OrgName if possible
        try {
            if (user && user.OrgID) {
                const [orgRows] = await pool.query('SELECT OrgName FROM Organizations WHERE OrgID = ? LIMIT 1', [user.OrgID]);
                if (orgRows && orgRows.length > 0) user.OrgName = orgRows[0].OrgName;
            }
        } catch (e) {
            console.warn('Could not enrich user with OrgName:', e && (e.message || e));
        }

        // 4. *** Create a unique and encrypted JWT Token ***
        const payload = {
            userId: userId,
            role: usertype
        };

        // The JWT_SECRET is used here on the server to create the token's signature.
        // The frontend receives the final 'token', but not the secret itself.
        const token = jwt.sign(payload, JWT_SECRET, {
            // ดึงค่าเวลาหมดอายุทั้งหมดจาก .env  เป็นค่าเริ่มต้น
            expiresIn: process.env.JWT_EXPIRES_IN
        });
        
        // 5. Send the response back
        res.status(200).json({
            success: true,
            message: 'Login Successful',
            token: token, // <-- Use the newly created JWT Token
            userInfo: user, 
            usertype: usertype,
            role: usertype
        });

    } catch (error) {
        // Handle errors from the database query
        console.error('Database Query Error:', error);

        // Fallback: if stored procedures are failing due to mysql system tables mismatch,
        // try a direct query against AdminUsers and Officers tables as a temporary workaround.
        if (error && (error.code === 'ER_COL_COUNT_DOESNT_MATCH_PLEASE_UPDATE' || error.code === 'ER_SP_DOES_NOT_EXIST')) {
            console.log('ℹ️ Stored procedure failure detected — attempting fallback direct queries (AdminUsers/Officers)');
            try {
                // Try AdminUsers first (login by AdminUserID)
                const [admins] = await pool.execute(
                    'SELECT AdminUserID, AdminName, AdminEmail, AdminPassword, ParentAdminID FROM AdminUsers WHERE AdminUserID = ? AND AdminPassword = ?',
                    [id, password]
                );
                if (admins && admins.length > 0) {
                    const user = admins[0];
                    const userId = user.AdminUserID;
                    const userName = user.AdminName;
                    // Determine super admin if ParentAdminID equals AdminUserID or NULL logic
                    let usertype = 'Admin';
                    if (user.ParentAdminID && Number(user.ParentAdminID) === Number(user.AdminUserID)) {
                        usertype = 'Super Admin';
                    }

                    const payload = { userId, usertype, role: usertype };
                    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

                    console.log(`Login Successful (fallback) for admin: ${userName} (ID: ${userId}), Role: ${usertype}`);
                    return res.status(200).json({ success: true, message: 'Login Successful (fallback)', token, userInfo: user, usertype, role: usertype });
                }

                // Try Officers table (login by OfficerID)
                // ✅ Added OrgID to SELECT so we can fetch OrgName
                const [officers] = await pool.execute(
                    'SELECT OfficerID, OfficerName, Email AS OfficerEmail, OfficerPassword, OrgID FROM Officers WHERE OfficerID = ? AND OfficerPassword = ?',
                    [id, password]
                );
                if (officers && officers.length > 0) {
                    const user = officers[0];
                    const userId = user.OfficerID;
                    const userName = user.OfficerName;
                    const usertype = 'Officer';

                    // ✅ Enrich with OrgName if OrgID exists (Fallback path)
                    try {
                        if (user.OrgID) {
                            const [orgRows] = await pool.query('SELECT OrgName FROM Organizations WHERE OrgID = ? LIMIT 1', [user.OrgID]);
                            if (orgRows && orgRows.length > 0) user.OrgName = orgRows[0].OrgName;
                        }
                    } catch (e) {
                        console.warn('Could not enrich user with OrgName (fallback):', e && (e.message || e));
                    }

                    const payload = { userId, usertype, role: usertype };
                    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

                    console.log(`Login Successful (fallback) for officer: ${userName} (ID: ${userId})`);
                    return res.status(200).json({ success: true, message: 'Login Successful (fallback)', token, userInfo: user, usertype, role: usertype });
                }

                // If still not found, treat as invalid credentials
                console.log('Access Denied (fallback): Invalid ID or Password');
                return res.status(401).json({ success: false, message: 'Invalid ID or Password!' });
            } catch (fallbackErr) {
                console.error('Fallback login query error:', fallbackErr);
                return res.status(500).json({ success: false, message: 'Internal Server Error: Database fallback failed.' });
            }
        }

        // Default error response
        res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error: Database access failed.' 
        });
    }
};

module.exports = loginService; // Export the loginService function