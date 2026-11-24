const { execFile } = require('child_process');
const db = require('../config/db');

/**
 * Memutus sesi user aktif pada MikroTik ROS v7 via RADIUS Disconnect-Request (UDP 3799)
 */
async function disconnectUserSession(username, ownerFilter = null) {
    let sql = `
        SELECT ra.acctsessionid, ra.username, ra.framedipaddress, ra.nasipaddress,
               n.ports, n.secret
        FROM radacct ra
        INNER JOIN nas n ON n.nasname = ra.nasipaddress
        INNER JOIN vouchers v ON v.username = ra.username
        WHERE ra.username = ? AND ra.acctstoptime IS NULL
    `;
    const params = [username];

    if (ownerFilter !== null) {
        sql += ` AND v.owner_id = ?`;
        params.push(ownerFilter);
    }

    const [sessions] = await db.query(sql, params);
    if (!sessions.length) {
        return { disconnected: 0, message: 'Tidak ada sesi aktif atau akses ditolak.' };
    }

    const results = [];
    for (const s of sessions) {
        const payload = [
            `User-Name = "${s.username}"`,
            `Acct-Session-Id = "${s.acctsessionid}"`,
            s.framedipaddress ? `Framed-IP-Address = ${s.framedipaddress}` : ''
        ].filter(Boolean).join('\n');

        const target = `${s.nasipaddress}:${s.ports || 3799}`;

        const res = await new Promise((resolve) => {
            const child = execFile(
                'radclient',
                ['-r', '2', '-t', '2', target, 'disconnect', s.secret],
                { timeout: 5000 },
                (error, stdout, stderr) => {
                    if (error) {
                        resolve({ nas: s.nasipaddress, success: false, error: stderr || error.message });
                    } else {
                        resolve({ nas: s.nasipaddress, success: true, output: stdout.trim() });
                    }
                }
            );
            child.stdin.write(payload);
            child.stdin.end();
        });

        if (res.success) {
            await db.query(
                `UPDATE radacct SET acctstoptime = NOW(), acctterminatecause = 'Admin-Reset'
                 WHERE acctsessionid = ? AND acctstoptime IS NULL`,
                [s.acctsessionid]
            );
        }
        results.push(res);
    }

    return {
        disconnected: results.filter((r) => r.success).length,
        details: results
    };
}

module.exports = { disconnectUserSession };
