const crypto = require('crypto');
const db = require('../config/db');
const { splitMikrotikQuota } = require('./quotaSyncService');

const SAFE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateRandomCode(length = 6, prefix = '') {
    let result = prefix;
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        result += SAFE_CHARS[bytes[i] % SAFE_CHARS.length];
    }
    return result;
}

async function syncProfileToRadiusGroup(conn, profile) {
    await conn.query('DELETE FROM radgroupreply WHERE groupname = ?', [profile.groupname]);
    await conn.query('DELETE FROM radgroupcheck WHERE groupname = ?', [profile.groupname]);

    const replies = [
        ['Mikrotik-Rate-Limit', '=', profile.rate_limit],
        ['Idle-Timeout', '=', String(profile.idle_timeout_sec || 300)]
    ];
    if (profile.session_timeout_sec > 0) {
        replies.push(['Session-Timeout', '=', String(profile.session_timeout_sec)]);
    }
    if (profile.ip_pool) {
        replies.push(['Framed-Pool', '=', profile.ip_pool]);
    }
    if (BigInt(profile.quota_bytes) > 0n) {
        const { limit, gigawords } = splitMikrotikQuota(BigInt(profile.quota_bytes));
        replies.push(['Mikrotik-Total-Limit', '=', String(limit)]);
        replies.push(['Mikrotik-Total-Limit-Gigawords', '=', String(gigawords)]);
    }

    for (const [attr, op, val] of replies) {
        await conn.query(
            'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
            [profile.groupname, attr, op, val]
        );
    }

    if (profile.shared_users > 0) {
        await conn.query(
            'INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES (?, "Simultaneous-Use", ":=", ?)',
            [profile.groupname, String(profile.shared_users)]
        );
    }
}

async function generateVoucherBatch({
    ownerId,
    role,
    profileId,
    quantity,
    codeLength = 6,
    prefix = '',
    authMode = 'same',
    customSalePrice = null
}) {
    const qty = Math.min(Math.max(parseInt(quantity, 10), 1), 1000);
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [[profile]] = await conn.query('SELECT * FROM cloud_profiles WHERE id = ?', [profileId]);
        if (!profile) throw new Error('Profil tidak ditemukan.');

        await syncProfileToRadiusGroup(conn, profile);

        const defaultPrice = role === 'reseller' && Number(profile.reseller_price) > 0
            ? Number(profile.reseller_price)
            : Number(profile.price);
        const unitPrice = customSalePrice !== null && customSalePrice !== '' ? Number(customSalePrice) : defaultPrice;
        const totalPrice = unitPrice * qty;
        const batchCode = `BCH-${Date.now().toString(36).toUpperCase()}`;

        const [batchRes] = await conn.query(
            `INSERT INTO voucher_batches 
             (batch_code, owner_id, profile_id, auth_mode, quantity, unit_sale_price, total_sale_price)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [batchCode, ownerId, profileId, authMode, qty, unitPrice, totalPrice]
        );
        const batchId = batchRes.insertId;

        const generated = [];
        const localSet = new Set();
        let attempts = 0;

        while (generated.length < qty && attempts < qty * 10) {
            attempts++;
            const username = generateRandomCode(codeLength, prefix);
            if (localSet.has(username)) continue;

            const [[dupV]] = await conn.query('SELECT id FROM vouchers WHERE username = ? LIMIT 1', [username]);
            const [[dupR]] = await conn.query('SELECT id FROM radcheck WHERE username = ? LIMIT 1', [username]);
            if (dupV || dupR) continue;

            localSet.add(username);
            const password = authMode === 'same' ? username : generateRandomCode(codeLength, '');
            generated.push({ username, password });
        }

        if (generated.length < qty) {
            throw new Error('Gagal menghasilkan kode unik yang cukup. Perpanjang panjang karakter kode.');
        }

        const voucherValues = generated.map((g) => [batchId, ownerId, profileId, g.username, g.password, unitPrice, 'unused']);
        const radcheckValues = generated.map((g) => [g.username, 'Cleartext-Password', ':=', g.password]);
        const usergroupValues = generated.map((g) => [g.username, profile.groupname, 1]);

        await conn.query(
            'INSERT INTO vouchers (batch_id, owner_id, profile_id, username, password, sale_price, status) VALUES ?',
            [voucherValues]
        );
        await conn.query(
            'INSERT INTO radcheck (username, attribute, op, value) VALUES ?',
            [radcheckValues]
        );
        await conn.query(
            'INSERT INTO radusergroup (username, groupname, priority) VALUES ?',
            [usergroupValues]
        );

        await conn.commit();
        return { batchId, batchCode, quantity: qty, unitPrice, totalPrice };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = { generateVoucherBatch, syncProfileToRadiusGroup };
