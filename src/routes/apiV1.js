const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/authRbac');
const { generateVoucherBatch, syncProfileToRadiusGroup } = require('../services/voucherBatchService');
const { disconnectUserSession } = require('../services/radiusCoaService');

const router = express.Router();

// 1. Auth Login
router.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [[user]] = await db.query('SELECT * FROM app_users WHERE email = ? AND is_active = 1', [email]);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Email atau password salah.' });
        }
        const token = jwt.sign(
            { id: user.id, name: user.name, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Dashboard Summary
router.get('/dashboard/summary', authenticate, async (req, res) => {
    try {
        const [[activeRow]] = await db.query(
            `SELECT COUNT(*) AS cnt FROM radacct ra
             INNER JOIN vouchers v ON v.username = ra.username
             WHERE ra.acctstoptime IS NULL AND (? = 1 OR v.owner_id = ?)`,
            [req.isAdmin, req.ownerScope]
        );
        const [[salesRow]] = await db.query(
            `SELECT 
                COUNT(CASE WHEN status IN ('active','expired') THEN 1 END) AS sold,
                COALESCE(SUM(CASE WHEN status IN ('active','expired') THEN sale_price ELSE 0 END), 0) AS revenue,
                ROUND(COALESCE(SUM(total_bytes_used), 0) / 1073741824, 2) AS totalGb
             FROM vouchers
             WHERE (? = 1 OR owner_id = ?)`,
            [req.isAdmin, req.ownerScope]
        );
        res.json({
            activeSessions: activeRow.cnt,
            soldVouchers: salesRow.sold,
            revenue: salesRow.revenue,
            totalGb: salesRow.totalGb
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. NAS / Router Settings (Admin Only)
router.get('/nas', authenticate, requireAdmin, async (req, res) => {
    const [rows] = await db.query('SELECT id, nasname, shortname, ports, description, is_active, created_at FROM nas ORDER BY id DESC');
    res.json(rows);
});

router.post('/nas', authenticate, requireAdmin, async (req, res) => {
    try {
        const { nasname, shortname, secret, ports = 3799, description = 'MikroTik ROS v7' } = req.body;
        await db.query(
            'INSERT INTO nas (nasname, shortname, secret, ports, description) VALUES (?, ?, ?, ?, ?)',
            [nasname, shortname, secret, ports, description]
        );
        res.status(201).json({ status: 'success' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// 4. Profiles
router.get('/profiles', authenticate, async (req, res) => {
    const [rows] = await db.query('SELECT * FROM cloud_profiles ORDER BY price ASC');
    res.json(rows);
});

router.post('/profiles', authenticate, requireAdmin, async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const {
            groupname, display_name, service_type = 'hotspot', rate_limit,
            quota_bytes = 0, session_timeout_sec = 0, validity_sec = 0,
            shared_users = 1, idle_timeout_sec = 300, ip_pool = null, price = 0, reseller_price = 0
        } = req.body;

        const [ins] = await conn.query(
            `INSERT INTO cloud_profiles 
             (groupname, display_name, service_type, rate_limit, quota_bytes, session_timeout_sec, validity_sec, shared_users, idle_timeout_sec, ip_pool, price, reseller_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [groupname, display_name, service_type, rate_limit, quota_bytes, session_timeout_sec, validity_sec, shared_users, idle_timeout_sec, ip_pool, price, reseller_price]
        );
        const [[profile]] = await conn.query('SELECT * FROM cloud_profiles WHERE id = ?', [ins.insertId]);
        await syncProfileToRadiusGroup(conn, profile);
        await conn.commit();
        res.status(201).json(profile);
    } catch (err) {
        await conn.rollback();
        res.status(400).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// 5. Generate & List Vouchers
router.post('/vouchers/generate', authenticate, async (req, res) => {
    try {
        const result = await generateVoucherBatch({
            ownerId: req.user.id,
            role: req.user.role,
            ...req.body
        });
        res.status(201).json({ status: 'success', data: result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.get('/vouchers', authenticate, async (req, res) => {
    const [rows] = await db.query(
        `SELECT v.*, cp.display_name AS profile_name, vb.batch_code
         FROM vouchers v
         INNER JOIN cloud_profiles cp ON cp.id = v.profile_id
         INNER JOIN voucher_batches vb ON vb.id = v.batch_id
         WHERE (? = 1 OR v.owner_id = ?)
         ORDER BY v.id DESC LIMIT 500`,
        [req.isAdmin, req.ownerScope]
    );
    res.json(rows);
});

router.get('/vouchers/batch/:id/print', authenticate, async (req, res) => {
    try {
        const batchId = req.params.id;
        const [[batch]] = await db.query(
            'SELECT * FROM voucher_batches WHERE id = ? AND (? = 1 OR owner_id = ?)',
            [batchId, req.isAdmin, req.ownerScope]
        );
        if (!batch) return res.status(404).json({ error: 'Batch tidak ditemukan.' });

        await db.query(
            'UPDATE voucher_batches SET printed_count = printed_count + 1, last_printed_at = NOW() WHERE id = ?',
            [batchId]
        );
        const [[profile]] = await db.query('SELECT * FROM cloud_profiles WHERE id = ?', [batch.profile_id]);
        const [vouchers] = await db.query('SELECT * FROM vouchers WHERE batch_id = ? ORDER BY id ASC', [batchId]);

        res.json({ batch, profile, vouchers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Active Sessions & CoA Kick
router.get('/sessions/active', authenticate, async (req, res) => {
    const [rows] = await db.query(
        `SELECT 
            ra.radacctid, ra.username, cp.display_name AS profile_name,
            ra.framedipaddress AS ip_address, ra.callingstationid AS mac_address,
            ra.nasipaddress, TIMESTAMPDIFF(SECOND, ra.acctstarttime, NOW()) AS uptime_sec,
            ra.acctinputoctets AS upload_bytes, ra.acctoutputoctets AS download_bytes,
            ROUND((ra.acctinputoctets + ra.acctoutputoctets) / 1048576, 2) AS total_mb
         FROM radacct ra
         INNER JOIN vouchers v ON v.username = ra.username
         INNER JOIN cloud_profiles cp ON cp.id = v.profile_id
         WHERE ra.acctstoptime IS NULL
           AND (? = 1 OR v.owner_id = ?)
         ORDER BY ra.acctstarttime DESC`,
        [req.isAdmin, req.ownerScope]
    );
    res.json(rows);
});

router.post('/sessions/:username/kick', authenticate, async (req, res) => {
    try {
        const result = await disconnectUserSession(req.params.username, req.ownerScope);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. Reports
router.get('/reports/sales', authenticate, async (req, res) => {
    const [byProfile] = await db.query(
        `SELECT 
            cp.display_name AS profile_name,
            COUNT(v.id) AS total_generated,
            SUM(CASE WHEN v.status IN ('active', 'expired') THEN 1 ELSE 0 END) AS total_used,
            SUM(CASE WHEN v.status IN ('active', 'expired') THEN v.sale_price ELSE 0 END) AS gross_revenue,
            ROUND(SUM(v.total_bytes_used) / 1073741824, 3) AS total_gb_used
         FROM vouchers v
         INNER JOIN cloud_profiles cp ON cp.id = v.profile_id
         WHERE (? = 1 OR v.owner_id = ?)
         GROUP BY cp.id, cp.display_name`,
        [req.isAdmin, req.ownerScope]
    );
    res.json({ byProfile });
});

module.exports = router;
