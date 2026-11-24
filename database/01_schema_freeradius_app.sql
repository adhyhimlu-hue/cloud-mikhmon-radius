CREATE DATABASE IF NOT EXISTS radius_cloud CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE radius_cloud;

-- ==========================================
-- 1. TABEL STANDAR FREERADIUS (Optimized)
-- ==========================================
CREATE TABLE IF NOT EXISTS nas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nasname VARCHAR(128) NOT NULL COMMENT 'IP WireGuard atau IP Publik Router',
    shortname VARCHAR(32) NOT NULL,
    type VARCHAR(30) DEFAULT 'other',
    ports INT DEFAULT 3799 COMMENT 'Port CoA/Disconnect ROS 7',
    secret VARCHAR(60) NOT NULL,
    server VARCHAR(64) DEFAULT NULL,
    community VARCHAR(50) DEFAULT NULL,
    description VARCHAR(200) DEFAULT 'MikroTik ROS v7',
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_nasname (nasname)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS radcheck (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT '==',
    value VARCHAR(253) NOT NULL DEFAULT '',
    INDEX idx_radcheck_user_attr (username, attribute)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS radreply (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT '=',
    value VARCHAR(253) NOT NULL DEFAULT '',
    INDEX idx_radreply_username (username)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS radgroupcheck (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT '==',
    value VARCHAR(253) NOT NULL DEFAULT '',
    INDEX idx_radgroupcheck_group (groupname)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS radgroupreply (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    attribute VARCHAR(64) NOT NULL DEFAULT '',
    op CHAR(2) NOT NULL DEFAULT '=',
    value VARCHAR(253) NOT NULL DEFAULT '',
    INDEX idx_radgroupreply_group (groupname)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS radusergroup (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL DEFAULT '',
    groupname VARCHAR(64) NOT NULL DEFAULT '',
    priority INT NOT NULL DEFAULT 1,
    INDEX idx_radusergroup_user (username),
    INDEX idx_radusergroup_group (groupname)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS radacct (
    radacctid BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    acctsessionid VARCHAR(64) NOT NULL DEFAULT '',
    acctuniqueid VARCHAR(32) NOT NULL DEFAULT '',
    username VARCHAR(64) NOT NULL DEFAULT '',
    realm VARCHAR(64) DEFAULT '',
    nasipaddress VARCHAR(15) NOT NULL DEFAULT '',
    nasportid VARCHAR(32) DEFAULT NULL,
    nasporttype VARCHAR(32) DEFAULT NULL,
    acctstarttime DATETIME NULL DEFAULT NULL,
    acctupdatetime DATETIME NULL DEFAULT NULL,
    acctstoptime DATETIME NULL DEFAULT NULL,
    acctinterval INT DEFAULT NULL,
    acctsessiontime INT UNSIGNED DEFAULT NULL,
    acctauthentic VARCHAR(32) DEFAULT NULL,
    connectinfo_start VARCHAR(50) DEFAULT NULL,
    connectinfo_stop VARCHAR(50) DEFAULT NULL,
    acctinputoctets BIGINT DEFAULT 0 COMMENT 'Upload bytes dari sisi client',
    acctoutputoctets BIGINT DEFAULT 0 COMMENT 'Download bytes ke sisi client',
    calledstationid VARCHAR(50) NOT NULL DEFAULT '',
    callingstationid VARCHAR(50) NOT NULL DEFAULT '' COMMENT 'MAC Address Client',
    acctterminatecause VARCHAR(32) NOT NULL DEFAULT '',
    servicetype VARCHAR(32) DEFAULT NULL,
    framedprotocol VARCHAR(32) DEFAULT NULL,
    framedipaddress VARCHAR(15) NOT NULL DEFAULT '',
    UNIQUE KEY uk_acctuniqueid (acctuniqueid),
    INDEX idx_active_sessions (acctstoptime, username, nasipaddress),
    INDEX idx_user_usage (username, acctstoptime, acctstarttime),
    INDEX idx_stale_cleanup (acctstoptime, acctupdatetime, acctstarttime)
) ENGINE=InnoDB;

-- ==========================================
-- 2. TABEL APLIKASI CLOUD MIKHMON
-- ==========================================
CREATE TABLE IF NOT EXISTS app_users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'reseller') NOT NULL DEFAULT 'reseller',
    balance DECIMAL(12,2) DEFAULT 0.00,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cloud_profiles (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    groupname VARCHAR(64) NOT NULL UNIQUE COMMENT 'Mapping ke radgroupreply/radgroupcheck',
    display_name VARCHAR(100) NOT NULL,
    service_type ENUM('hotspot', 'pppoe', 'both') DEFAULT 'hotspot',
    rate_limit VARCHAR(64) NOT NULL COMMENT 'Format ROS: rx/tx misal 2M/5M',
    quota_bytes BIGINT UNSIGNED DEFAULT 0 COMMENT '0 = Unlimited',
    session_timeout_sec INT UNSIGNED DEFAULT 0 COMMENT 'Durasi per sesi (detik)',
    validity_sec INT UNSIGNED DEFAULT 0 COMMENT 'Masa aktif sejak login pertama (detik)',
    shared_users INT UNSIGNED DEFAULT 1 COMMENT 'Simultaneous-Use',
    idle_timeout_sec INT UNSIGNED DEFAULT 300,
    ip_pool VARCHAR(64) DEFAULT NULL COMMENT 'Framed-Pool',
    price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    reseller_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS voucher_batches (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_code VARCHAR(32) NOT NULL UNIQUE,
    owner_id INT UNSIGNED NOT NULL,
    profile_id INT UNSIGNED NOT NULL,
    nas_id INT UNSIGNED NULL COMMENT 'Opsional: kunci voucher ke NAS tertentu',
    auth_mode ENUM('same', 'separate') NOT NULL DEFAULT 'same',
    quantity INT UNSIGNED NOT NULL,
    unit_sale_price DECIMAL(12,2) NOT NULL,
    total_sale_price DECIMAL(12,2) NOT NULL,
    printed_count INT UNSIGNED DEFAULT 0,
    last_printed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES app_users(id),
    FOREIGN KEY (profile_id) REFERENCES cloud_profiles(id),
    INDEX idx_batch_owner_date (owner_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vouchers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_id INT UNSIGNED NOT NULL,
    owner_id INT UNSIGNED NOT NULL,
    profile_id INT UNSIGNED NOT NULL,
    username VARCHAR(64) NOT NULL UNIQUE,
    password VARCHAR(64) NOT NULL,
    sale_price DECIMAL(12,2) NOT NULL,
    status ENUM('unused', 'active', 'expired', 'disabled') NOT NULL DEFAULT 'unused',
    first_used_at DATETIME NULL,
    expires_at DATETIME NULL,
    total_bytes_used BIGINT UNSIGNED DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES voucher_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES app_users(id),
    FOREIGN KEY (profile_id) REFERENCES cloud_profiles(id),
    INDEX idx_voucher_owner_status (owner_id, status, created_at),
    INDEX idx_voucher_expiry (status, expires_at)
) ENGINE=InnoDB;

-- Seed awal Admin (Password: admin123 - harap segera diganti!)
INSERT IGNORE INTO app_users (id, name, email, password_hash, role) VALUES
(1, 'Administrator', 'admin@cloudmikhmon.local', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin');
