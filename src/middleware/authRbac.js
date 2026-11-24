const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token autentikasi diperlukan.' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        req.isAdmin = decoded.role === 'admin' ? 1 : 0;
        req.ownerScope = decoded.role === 'admin' ? null : decoded.id;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token tidak valid atau kedaluwarsa.' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Akses ditolak. Hanya untuk Administrator.' });
    }
    next();
}

module.exports = { authenticate, requireAdmin };
