const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'radius_app',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'radius_cloud',
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    timezone: '+00:00'
});

module.exports = pool;
