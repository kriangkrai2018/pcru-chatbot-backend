// Utility: getDefaultContact(s) — returns default contact(s) from DB
const { formatThaiPhone } = require('./formatPhone');

// Helper: split phone text into multiple phone entries
const parsePhones = (raw) => {
  if (!raw) return [];
  return String(raw).split(/(?:หรือ|,|;|\/|\||\n)/i).map(p => p.trim()).filter(Boolean);
};

async function getDefaultContact(pool) {
  if (!pool) return null;

  const officerId = process.env.DEFAULT_CONTACT_OFFICER_ID ? String(process.env.DEFAULT_CONTACT_OFFICER_ID).trim() : null;
  const namePattern = process.env.DEFAULT_CONTACT_OFFICER_NAME ? String(process.env.DEFAULT_CONTACT_OFFICER_NAME).trim() : null;
  const orgPattern = process.env.DEFAULT_CONTACT_ORG_NAME ? String(process.env.DEFAULT_CONTACT_ORG_NAME).trim() : null;

  try {
    let rows = null;

    if (officerId) {
      const [r] = await pool.query(
        `SELECT o.OfficerPhone AS phone, o.OfficerName AS officer, org.OrgName AS organization
         FROM Officers o
         LEFT JOIN Organizations org ON o.OrgID = org.OrgID
         WHERE o.OfficerID = ? AND o.OfficerPhone IS NOT NULL AND TRIM(o.OfficerPhone) <> '' LIMIT 1`,
        [officerId]
      );
      rows = r;
    } else if (namePattern || orgPattern) {
      const nameLike = namePattern ? `%${namePattern}%` : null;
      const orgLike = orgPattern ? `%${orgPattern}%` : null;
      const [r] = await pool.query(
        `SELECT o.OfficerPhone AS phone, o.OfficerName AS officer, org.OrgName AS organization
         FROM Officers o
         LEFT JOIN Organizations org ON o.OrgID = org.OrgID
         WHERE (? IS NULL OR o.OfficerName LIKE ?) AND (? IS NULL OR org.OrgName LIKE ?) AND o.OfficerPhone IS NOT NULL LIMIT 1`,
        [nameLike, nameLike, orgLike, orgLike]
      );
      rows = r;
    } else {
      return null;
    }

    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    return {
      organization: r.organization || null,
      officer: r.officer || null,
      phone: r.phone || null,
      officerPhoneRaw: r.phone || null,
      officerPhone: r.phone ? formatThaiPhone(r.phone) : null
    };
  } catch (e) {
    console.error('getDefaultContact failed:', e && (e.message || e));
    return null;
  }
}

// Helper: build contact lines (array) from raw contact text
function buildContactLines(raw) {
  if (!raw) return [];
  const clean = String(raw).replace(/^เบอร์โทรศัพท์\s*:\s*/i, '').replace(/^ติดต่อ\s*:\s*/i, '').trim();
  const parts = parsePhones(clean).map(p => String(p || '').trim()).filter(Boolean);
  const lines = [];

  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];

    // If part is a link label like 'ลิงค์ :' and next exists, merge with next/continuations
    if (/^ลิงค์\s*:??$/i.test(p)) {
      if (parts[i+1]) {
        let url = parts[i+1];
        let j = i + 2;
        while (j < parts.length && (/^[\?=&%:\/\.\w\-]+$/.test(parts[j]) || /^[a-zA-Z_]+$/.test(parts[j]) || parts[j].includes('='))) {
          url += parts[j];
          j++;
        }
        lines.push(`ลิงค์ : ${url}`);
        i = j - 1;
      } else {
        // standalone label, just push it
        lines.push('ลิงค์ :');
      }
      continue;
    }

    // If this part looks like a URL or domain, try to merge with subsequent fragments
    if (/^(https?:\/\/|www\.|facebook\.|fb\.|fbcdn\.)/i.test(p) || /facebook\.com/i.test(p) || /^\S+\.[a-z]{2,}$/i.test(p)) {
      let url = p;
      let j = i + 1;
      while (j < parts.length && (/^[\?=&%:\/\.\w\-]+$/.test(parts[j]) || /^[a-zA-Z_]+$/.test(parts[j]) || parts[j].includes('='))) {
        url += parts[j];
        j++;
      }
      // Normalize spaces inside URL fragments
      url = url.replace(/\s+/g, '');
      // Prefer 'ลิงค์ : <url>' for domain-like strings
      if (!/^https?:\/\//i.test(url)) url = url; // keep as-is if already complete
      lines.push(/^https?:\/\//i.test(url) ? `ลิงค์ : ${url}` : `ลิงค์ : ${url}`);
      i = j - 1;
      continue;
    }

    // Handle 'ต่อ' with missing extension on current part (e.g., '056-717-100 ต่อ' + '1121')
    if (/ต่อ\s*$/i.test(p) && parts[i+1] && /^[0-9]{1,5}$/.test(parts[i+1])) {
      lines.push(`ติดต่อ: ${p} ${parts[i+1]}`);
      i++; // skip next
      continue;
    }

    // If this part is just a small numeric extension and previous part looked like 'ต่อ', merge back
    if (/^[0-9]{1,5}$/.test(p) && lines.length > 0) {
      const prev = lines[lines.length - 1];
      if (/ติดต่อ:.*ต่อ$/.test(prev)) {
        // append extension to previous
        lines[lines.length - 1] = `${prev} ${p}`;
        continue;
      }
    }

    // Default: phone/contact line
    lines.push(`ติดต่อ: ${p}`);
  }

  return lines;
}

// Helper: format contact for display (preserve original DB contact string)
const formatContact = (c) => {
  return c ? String(c).trim() : null;
};

async function getDefaultContacts(pool) {
  if (!pool) return [];
  try {
    const [rows] = await pool.query(
      `SELECT org.OrgName AS organization, c.CategoriesName AS category, cc.Contact AS contact
       FROM Categories_Contact cc
       LEFT JOIN Categories c ON cc.CategoriesID = c.CategoriesID
       LEFT JOIN Officers o ON c.OfficerID = o.OfficerID
       LEFT JOIN Organizations org ON o.OrgID = org.OrgID
       ORDER BY org.OrgName ASC, c.CategoriesName ASC`
    );

    if (!rows || rows.length === 0) return [];

    const contacts = rows.map(r => {
      const raw = r.contact || '';
      // Build same lines as formatContact but keep array form for frontend
      const clean = String(raw).replace(/^เบอร์โทรศัพท์\s*:\s*/i, '').replace(/^ติดต่อ\s*:\s*/i, '').trim();
      const parts = parsePhones(clean).map(p => String(p || '').trim()).filter(Boolean);
      const lines = buildContactLines(clean);

      return {
        organization: r.organization || null,
        category: r.category || null,
        // Preserve original DB contact string (trimmed). Do not split or add contactLines here.
        contact: r.contact ? String(r.contact).trim() : null
      };
    });

    return contacts;
  } catch (e) {
    console.error('getDefaultContacts failed:', e && (e.message || e));
    return [];
  }
}

module.exports = { getDefaultContact, getDefaultContacts };
