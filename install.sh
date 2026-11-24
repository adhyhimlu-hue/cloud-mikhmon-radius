#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Auto-Installer Cloud-Mikhmon RADIUS (FreeRADIUS 3 + MariaDB + Node.js + PM2)
# Target OS: Debian 11/12 & Ubuntu 22.04/24.04 LTS (Armbian / VPS x86_64 & ARM64)
# ==============================================================================

if [[ $EUID -ne 0 ]]; then
   echo "❌ Harap jalankan script ini sebagai root (sudo bash install.sh)"
   exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_NAME="radius_cloud"
DB_USER="radius_app"
DB_PASS="$(openssl rand -hex 12)"
JWT_SECRET="$(openssl rand -hex 32)"
APP_PORT="3000"

echo "============================================================"
echo " ⚡ Memulai Instalasi Otomatis Cloud-Mikhmon RADIUS"
echo "============================================================"

# 1. Update & Install Dependensi Sistem
echo "[1/7] Menginstal MariaDB, FreeRADIUS, Node.js, dan Utilitas..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl gnupg2 ca-certificates lsb-release openssl     mariadb-server mariadb-client     freeradius freeradius-mysql freeradius-utils

# Instal Node.js 20 LTS jika belum terpasang
if ! command -v node >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

# Instal PM2 untuk menjaga aplikasi tetap berjalan
if ! command -v pm2 >/dev/null 2>&1; then
    npm install -g pm2
fi

# 2. Konfigurasi Database MariaDB & Import Skema
echo "[2/7] Membuat Database & User MariaDB..."
systemctl enable --now mariadb

mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'127.0.0.1';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
SET GLOBAL event_scheduler = ON;
FLUSH PRIVILEGES;
EOF

# Pastikan event_scheduler permanen setelah reboot
if ! grep -q "event_scheduler=ON" /etc/mysql/mariadb.conf.d/50-server.cnf 2>/dev/null; then
    sed -i '/\[mysqld\]/a event_scheduler=ON' /etc/mysql/mariadb.conf.d/50-server.cnf || true
fi

echo "[3/7] Mengimpor Skema SQL FreeRADIUS & Aplikasi..."
mysql -u root "${DB_NAME}" < "${APP_DIR}/database/01_schema_freeradius_app.sql"
mysql -u root "${DB_NAME}" < "${APP_DIR}/database/02_events_stale_sessions.sql"

# 3. Generate File .env
echo "[4/7] Membuat file konfigurasi .env..."
cat > "${APP_DIR}/.env" <<EOF
PORT=${APP_PORT}
NODE_ENV=production
JWT_SECRET=${JWT_SECRET}
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASS=${DB_PASS}
DB_NAME=${DB_NAME}
EOF
chmod 600 "${APP_DIR}/.env"

# 4. Konfigurasi FreeRADIUS 3 SQL & Dictionary MikroTik
echo "[5/7] Mengonfigurasi FreeRADIUS 3 (rlm_sql & dictionary.mikrotik)..."
FR_DIR="/etc/freeradius/3.0"

if [[ -d "${FR_DIR}" ]]; then
    # Backup konfigurasi asli jika belum ada backup
    [[ ! -f "${FR_DIR}/mods-available/sql.bak" ]] && cp "${FR_DIR}/mods-available/sql" "${FR_DIR}/mods-available/sql.bak"

    cat > "${FR_DIR}/mods-available/sql" <<EOF
sql {
    driver = "rlm_sql_mysql"
    dialect = "mysql"
    server = "127.0.0.1"
    port = 3306
    login = "${DB_USER}"
    password = "${DB_PASS}"
    radius_db = "${DB_NAME}"

    acct_table1 = "radacct"
    acct_table2 = "radacct"
    postauth_table = "radpostauth"
    authcheck_table = "radcheck"
    groupcheck_table = "radgroupcheck"
    authreply_table = "radreply"
    groupreply_table = "radgroupreply"
    usergroup_table = "radusergroup"
    delete_stale_sessions = yes

    read_clients = yes
    client_table = "nas"

    pool {
        start = 10
        min = 5
        max = 32
        spare = 10
        uses = 0
        retry_delay = 30
        lifetime = 0
        idle_timeout = 60
    }

    \$INCLUDE \${modconfdir}/\${.:name}/main/\${dialect}/queries.conf
}
EOF

    ln -sf "${FR_DIR}/mods-available/sql" "${FR_DIR}/mods-enabled/sql"

    # Pastikan dictionary.mikrotik di-include
    if ! grep -q "dictionary.mikrotik" "${FR_DIR}/dictionary"; then
        echo '$INCLUDE /usr/share/freeradius/dictionary.mikrotik' >> "${FR_DIR}/dictionary"
    fi

    # Aktifkan pemanggilan sql di sites-enabled/default (mengganti -sql menjadi sql)
    sed -i 's/^[[:space:]]*-sql/        sql/' "${FR_DIR}/sites-enabled/default"

    chown -R freerad:freerad "${FR_DIR}/mods-available/sql"
    systemctl enable --now freeradius
    systemctl restart freeradius
else
    echo "⚠️ Direktori ${FR_DIR} tidak ditemukan. Lewati konfigurasi otomatis FreeRADIUS."
fi

# 5. Instalasi Dependensi Node.js & Menjalankan Service via PM2
echo "[6/7] Menginstal Dependensi Node.js & Menjalankan Aplikasi..."
cd "${APP_DIR}"
npm install --omit=dev
pm2 delete cloud-mikhmon-radius >/dev/null 2>&1 || true
pm2 start src/server.js --name cloud-mikhmon-radius
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# 6. Setup Cron Job Sinkronisasi Kuota & Masa Aktif (Setiap 1 Menit)
echo "[7/7] Menambahkan Cron Job Sinkronisasi Kuota..."
CRON_CMD="* * * * * /usr/bin/node ${APP_DIR}/src/jobs/runQuotaSync.js >> /var/log/cloud-mikhmon-sync.log 2>&1"
(crontab -l 2>/dev/null | grep -v "runQuotaSync.js"; echo "${CRON_CMD}") | crontab -

SERVER_IP=$(hostname -I | awk '{print $1}')
echo "============================================================"
echo " ✅ INSTALASI SELESAI!"
echo "============================================================"
echo " URL Web Dashboard : http://${SERVER_IP}:${APP_PORT}"
echo " Login Email       : admin@cloudmikhmon.local"
echo " Login Password    : admin123 (Segera ganti setelah login!)"
echo " Database Name     : ${DB_NAME}"
echo " Database User     : ${DB_USER}"
echo " Database Password : ${DB_PASS}"
echo " File .env         : ${APP_DIR}/.env"
echo "============================================================"
