const db = require('../config/db');
const { disconnectUserSession } = require('./radiusCoaService');

const FOUR_GB = 4294967296n; // 2^32 bytes

function splitMikrotikQuota(remainingBytesBigInt) {
    if (remainingBytesBigInt <= 0n) return { limit: 0, gigawords: 0 };
    const gigawords = Number(remainingBytesBigInt / FOUR_GB);
    const limit = Number(remainingBytesBigInt % FOUR_GB);
    return { limit, gigawords };
}

async function upsertRadReply(conn, username, attribute, value) {
    const [rows] = await conn.query(
        'SELECT id FROM radreply WHERE username = ? AND attribute = ? LIMIT 1',
        [username, attribute]
    );
    if (rows.length) {
        await conn.query('UPDATE radreply SET value = ? WHERE id = ?', [value, rows[0].id]);
    } else {
        await conn.query(
            'INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, "=", ?)',
            [username, attribute, value]
        );
    }
}

async function enforceBlockAndDisconnect(conn, voucherId, username) {
    await conn.query(`UPDATE vouchers SET status = 'expired' WHERE id = ?`, [voucherId]);

    const [exists] = await conn.query(
        `SELECT id FROM radcheck WHERE username = ? AND attribute = 'Auth-Type' LIMIT 1`,
        [username]
    );
    if (!exists.length) {
        await conn.query(
            `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Auth-Type', ':=', 'Reject')`,
            [username]
        );
    } else {
        await conn.query(
            `UPDATE radcheck SET op = ':=', value = 'Reject' WHERE id = ?`,
            [exists[0].id]
        );
    }

    await disconnectUserSession(username);
}

async function syncQuotaAndValidity() {
    const conn = await db.getConnection();
    try {
        // 1. Catat login pertama & masa aktif
        await conn.query(`
            UPDATE vouchers v
            INNER JOIN cloud_profiles cp ON cp.id = v.profile_id
            INNER JOIN (
                SELECT username, MIN(acctstarttime) AS first_login
                FROM radacct
                GROUP BY username
            ) ra ON ra.username = v.username
            SET 
                v.status = 'active',
                v.first_used_at = ra.first_login,
                v.expires_at = IF(cp.validity_sec > 0, DATE_ADD(ra.first_login, INTERVAL cp.validity_sec SECOND), NULL)
            WHERE v.status = 'unused'
        `);

        // 2. Akumulasi pemakaian kuota
        await conn.query(`
            UPDATE vouchers v
            INNER JOIN (
                SELECT username, COALESCE(SUM(acctinputoctets + acctoutputoctets), 0) AS used_bytes
                FROM radacct
                GROUP BY username
            ) u ON u.username = v.username
            SET v.total_bytes_used = u.used_bytes
            WHERE v.status = 'active'
        `);

        // 3. Evaluasi batas waktu & batas kuota
        const [activeVouchers] = await conn.query(`
            SELECT v.id, v.username, v.expires_at, v.total_bytes_used,
                   cp.quota_bytes, cp.session_timeout_sec
            FROM vouchers v
            INNER JOIN cloud_profiles cp ON cp.id = v.profile_id
            WHERE v.status = 'active'
        `);

        for (const v of activeVouchers) {
            const now = new Date();
            const isTimeExpired = v.expires_at && new Date(v.expires_at) <= now;
            const quotaLimit = BigInt(v.quota_bytes || 0);
            const usedBytes = BigInt(v.total_bytes_used || 0);
            const isQuotaExhausted = quotaLimit > 0n && usedBytes >= quotaLimit;

            if (isTimeExpired || isQuotaExhausted) {
                await enforceBlockAndDisconnect(conn, v.id, v.username);
                continue;
            }

            if (v.expires_at) {
                const remSec = Math.max(1, Math.floor((new Date(v.expires_at) - now) / 1000));
                const effectiveTimeout = v.session_timeout_sec > 0
                    ? Math.min(remSec, v.session_timeout_sec)
                    : remSec;
                await upsertRadReply(conn, v.username, 'Session-Timeout', String(effectiveTimeout));
            }

            if (quotaLimit > 0n) {
                const remBytes = quotaLimit - usedBytes;
                const { limit, gigawords } = splitMikrotikQuota(remBytes);
                await upsertRadReply(conn, v.username, 'Mikrotik-Total-Limit', String(limit));
                await upsertRadReply(conn, v.username, 'Mikrotik-Total-Limit-Gigawords', String(gigawords));
            }
        }
    } finally {
        conn.release();
    }
}

module.exports = { syncQuotaAndValidity, splitMikrotikQuota, enforceBlockAndDisconnect };
