# ⚡ Cloud-Mikhmon RADIUS (MikroTik RouterOS v7)

Aplikasi web manajemen user Hotspot, PPPoE, Voucher, dan RADIUS terpusat berbasis Cloud dengan antarmuka ringan ala **Mikhmon**, ditenagai oleh **FreeRADIUS 3 + MariaDB + RADIUS Incoming CoA/Disconnect** yang kompatibel penuh dengan **MikroTik RouterOS v7 (ROS 7)**.

## Instalasi Otomatis Satu Perintah (`install.sh`)

Dukungan OS: **Debian 11/12** & **Ubuntu 22.04/24.04 LTS** (VPS x86_64 maupun Armbian ARM64).

```bash
git clone https://github.com/adhyhimlu-hue/cloud-mikhmon-radius.git
cd cloud-mikhmon-radius
sudo bash install.sh
```

Script `install.sh` akan otomatis melakukan:
1. Instalasi `mariadb-server`, `freeradius`, `freeradius-mysql`, `freeradius-utils` (`radclient`), `nodejs` 20 LTS, dan `pm2`.
2. Pembuatan database `radius_cloud`, user database dengan password acak aman, pengaktifan `event_scheduler`, dan impor skema SQL (`01_schema_freeradius_app.sql` & `02_events_stale_sessions.sql`).
3. Pembuatan file `.env` beserta `JWT_SECRET` acak.
4. Konfigurasi modul `sql` FreeRADIUS 3 (`read_clients = yes`, `client_table = "nas"`) serta aktivasi `dictionary.mikrotik`.
5. Menjalankan backend Node.js secara permanen dengan **PM2** dan mendaftarkan **Cron Job** tiap 1 menit untuk sinkronisasi kuota (>4 GB), masa aktif, dan pemblokiran otomatis (`Auth-Type := Reject` + CoA Kick).

## Konfigurasi MikroTik RouterOS v7

Jalankan perintah berikut pada terminal MikroTik (ganti `10.200.0.1` dengan IP WireGuard atau IP Publik server Cloud RADIUS Anda):

```routeros
/radius
add address=10.200.0.1 secret="SecretNasRouter01" service=hotspot,ppp timeout=3000ms

/radius incoming
set accept=yes port=3799

/ip hotspot profile
set [find default=yes] use-radius=yes radius-accounting=yes radius-interim-update=5m

/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

/ip firewall filter
add chain=input protocol=udp dst-port=3799 src-address=10.200.0.1 action=accept comment="Allow RADIUS CoA from Cloud"
add chain=input protocol=udp dst-port=3799 action=drop comment="Drop Unauthorized CoA"

---

## 📁 Struktur Direktori Proyek

```text
cloud-mikhmon-radius/
├── install.sh                         # Script auto-installer 1 perintah (Debian/Ubuntu/Armbian)
├── package.json                       # Dependensi Node.js & skrip PM2/Worker
├── .env.example                       # Template variabel environment
├── .gitignore                         # Daftar pengecualian file Git
├── README.md                          # Dokumentasi arsitektur & panduan instalasi
├── database/
│   ├── 01_schema_freeradius_app.sql   # Skema tabel FreeRADIUS + tabel aplikasi + index komposit
│   └── 02_events_stale_sessions.sql   # Event scheduler pembersih sesi gantung (stale sessions)
├── src/
│   ├── server.js                      # Entry point server Express & static file server
│   ├── config/
│   │   └── db.js                      # Connection pool MariaDB/MySQL (mysql2/promise)
│   ├── middleware/
│   │   └── authRbac.js                # Autentikasi JWT & RBAC ketat (Admin vs Reseller owner_id)
│   ├── jobs/
│   │   └── runQuotaSync.js            # Cron worker sinkronisasi kuota & masa aktif per menit
│   ├── services/
│   │   ├── radiusCoaService.js        # Eksekutor radclient Disconnect-Request (UDP 3799)
│   │   ├── quotaSyncService.js        # Kalkulasi kuota (>4GB), validity, auto-reject & kick
│   │   └── voucherBatchService.js     # Generator batch voucher transaksional anti-duplikat
│   └── routes/
│       └── apiV1.js                   # Endpoint REST API (/api/v1/...)
└── public/
    ├── index.html                     # Antarmuka Web Dashboard ala Mikhmon (Tailwind + Alpine.js)
    └── print.html                     # Halaman cetak siap print (Thermal 58/80mm & Grid A4/F4)
```

---

## 🚀 Tahapan Instalasi

### Opsi 1: Instalasi Otomatis Satu Perintah (Direkomendasikan)

Mendukung **Debian 11/12** & **Ubuntu 22.04/24.04 LTS** (baik arsitektur VPS `x86_64` maupun `ARM64` / Armbian).

1. **Clone repositori dari GitHub dan masuk ke direktori proyek:**
   ```bash
   git clone https://github.com/adhyhimlu-hue/cloud-mikhmon-radius.git
   cd cloud-mikhmon-radius
   ```

2. **Jalankan script auto-installer sebagai root:**
   ```bash
   sudo bash install.sh
   ```

   **Apa saja yang otomatis dikerjakan oleh `install.sh`?**
   - Menginstal paket sistem: `mariadb-server`, `freeradius`, `freeradius-mysql`, `freeradius-utils` (`radclient`), `nodejs` 20 LTS, dan `pm2`.
   - Membuat database `radius_cloud`, membuat user MariaDB dengan *password* acak aman, mengaktifkan `event_scheduler=ON` permanen, serta mengimpor skema SQL.
   - Menghasilkan file `.env` lengkap dengan `JWT_SECRET` acak 64-karakter (`chmod 600`).
   - Mengonfigurasi modul SQL FreeRADIUS 3 (`read_clients = yes`, `client_table = "nas"`) dan menyertakan kamus `dictionary.mikrotik`.
   - Menjalankan aplikasi Node.js secara permanen di latar belakang menggunakan **PM2** dan menambahkan **Cron Job** tiap 1 menit untuk sinkronisasi kuota/masa aktif.

---

### Opsi 2: Instalasi Manual (Langkah demi Langkah)

Gunakan langkah ini jika Anda ingin mengatur server secara manual:

#### 1. Instal Dependensi Sistem
```bash
sudo apt update && sudo apt install -y mariadb-server freeradius freeradius-mysql freeradius-utils curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

#### 2. Setup Database MariaDB & Impor Skema
Masuk ke console MariaDB (`sudo mysql -u root`) dan buat database beserta hak akses:
```sql
CREATE DATABASE radius_cloud CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'radius_app'@'127.0.0.1' IDENTIFIED BY 'PasswordKuatAnda';
GRANT ALL PRIVILEGES ON radius_cloud.* TO 'radius_app'@'127.0.0.1';
SET GLOBAL event_scheduler = ON;
FLUSH PRIVILEGES;
EXIT;
```
Impor file SQL yang tersedia:
```bash
mysql -u root radius_cloud < database/01_schema_freeradius_app.sql
mysql -u root radius_cloud < database/02_events_stale_sessions.sql
```

#### 3. Konfigurasi FreeRADIUS 3
1. Edit `/etc/freeradius/3.0/mods-available/sql` dan sesuaikan driver `rlm_sql_mysql`, dialek `mysql`, kredensial database `radius_cloud`, serta aktifkan `read_clients = yes` dengan `client_table = "nas"`.
2. Aktifkan modul SQL:
   ```bash
   sudo ln -sf /etc/freeradius/3.0/mods-available/sql /etc/freeradius/3.0/mods-enabled/sql
   ```
3. Pastikan baris berikut ada di `/etc/freeradius/3.0/dictionary`:
   ```text
   $INCLUDE /usr/share/freeradius/dictionary.mikrotik
   ```
4. Pastikan `sql` aktif (hilangkan tanda `-` pada `-sql`) di `/etc/freeradius/3.0/sites-enabled/default`, lalu restart FreeRADIUS:
   ```bash
   sudo systemctl restart freeradius
   ```

#### 4. Konfigurasi Aplikasi & Cron Worker
```bash
cp .env.example .env
nano .env # Sesuaikan DB_PASS dan JWT_SECRET

npm install --omit=dev
pm2 start src/server.js --name cloud-mikhmon-radius
pm2 save
```
Tambahkan jadwal Cron (`crontab -e`) untuk sinkronisasi kuota (> 4 GB), masa aktif, dan blokir otomatis setiap 1 menit:
```cron
* * * * * /usr/bin/node /path/ke/cloud-mikhmon-radius/src/jobs/runQuotaSync.js >> /var/log/cloud-mikhmon-sync.log 2>&1
```

---

## 🔌 Konfigurasi MikroTik RouterOS v7 (ROS 7)

1. Buka Web Dashboard (`http://IP_SERVER:3000`) dan login dengan akun bawaan:
   - **Email:** `admin@cloudmikhmon.local`
   - **Password:** `admin123` *(segera ubah setelah login pertama)*
2. Tambahkan Router Anda pada menu **Router / NAS** (isi IP WireGuard atau IP Publik MikroTik dan *Shared Secret*).
3. Jalankan skrip berikut pada **Terminal MikroTik ROS v7** Anda (ganti `10.200.0.1` dengan IP Server Cloud RADIUS dan `SecretNasRouter01` sesuai yang didaftarkan di web):

```routeros
# 1. Daftarkan Server Cloud RADIUS untuk layanan Hotspot & PPP
/radius
add address=10.200.0.1 secret="SecretNasRouter01" service=hotspot,ppp timeout=3000ms

# 2. Aktifkan RADIUS Incoming CoA/Disconnect pada port UDP 3799
/radius incoming
set accept=yes port=3799

# 3. Aktifkan RADIUS & Interim-Update 5 menit pada Profil Hotspot
/ip hotspot profile
set [find default=yes] use-radius=yes radius-accounting=yes radius-interim-update=5m

# 4. Aktifkan RADIUS & Interim-Update 5 menit pada PPP (PPPoE/L2TP)
/ppp aaa
set use-radius=yes accounting=yes interim-update=5m

# 5. Amankan port UDP 3799 di Firewall agar hanya menerima CoA dari Server Cloud RADIUS
/ip firewall filter
add chain=input protocol=udp dst-port=3799 src-address=10.200.0.1 action=accept comment="Allow RADIUS CoA from Cloud"
add chain=input protocol=udp dst-port=3799 action=drop comment="Drop Unauthorized CoA"
```

---

## 🛠️ Perintah Operasional & Troubleshooting

- **Cek status aplikasi web:** `pm2 status` atau `pm2 logs cloud-mikhmon-radius`
- **Cek debug FreeRADIUS secara langsung:** `sudo systemctl stop freeradius && sudo freeradius -X`
- **Cek log sinkronisasi kuota:** `tail -f /var/log/cloud-mikhmon-sync.log`
