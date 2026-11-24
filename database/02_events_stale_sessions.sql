USE radius_cloud;
SET GLOBAL event_scheduler = ON;

DELIMITER $$
CREATE EVENT IF NOT EXISTS evt_cleanup_stale_sessions
ON SCHEDULE EVERY 5 MINUTE
DO
BEGIN
    UPDATE radacct
    SET 
        acctstoptime = COALESCE(acctupdatetime, acctstarttime),
        acctsessiontime = TIMESTAMPDIFF(SECOND, acctstarttime, COALESCE(acctupdatetime, acctstarttime)),
        acctterminatecause = 'NAS-Reboot-Or-Timeout'
    WHERE acctstoptime IS NULL
      AND COALESCE(acctupdatetime, acctstarttime) < (NOW() - INTERVAL 15 MINUTE);
END$$
DELIMITER ;
