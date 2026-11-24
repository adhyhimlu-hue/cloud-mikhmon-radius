# ⚡ Cloud-Mikhmon RADIUS (MikroTik RouterOS v7)

Aplikasi web manajemen user Hotspot, PPPoE, Voucher, dan RADIUS terpusat berbasis Cloud dengan antarmuka ringan ala **Mikhmon**, ditenagai oleh **FreeRADIUS 3 + MariaDB + RADIUS Incoming CoA/Disconnect** yang kompatibel penuh dengan **MikroTik RouterOS v7 (ROS 7)**.

## Instalasi Otomatis Satu Perintah (`install.sh`)

Dukungan OS: **Debian 11/12** & **Ubuntu 22.04/24.04 LTS** (VPS x86_64 maupun Armbian ARM64).

```bash
git clone https://github.com/USERNAME_ANDA/cloud-mikhmon-radius.git
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
```
