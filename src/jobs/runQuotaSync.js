require('dotenv').config();
const { syncQuotaAndValidity } = require('../services/quotaSyncService');
const db = require('../config/db');

(async () => {
    try {
        await syncQuotaAndValidity();
        console.log(`[${new Date().toISOString()}] Quota & validity sync completed.`);
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Sync failed:`, err);
    } finally {
        await db.end();
    }
})();
