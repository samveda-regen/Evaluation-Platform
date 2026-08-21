-- Periodic client heartbeat timestamp, used by the expiry sweep to detect an abandoned
-- attempt (tab closed, crash, network loss) and auto-submit it before the full test
-- duration elapses, rather than only expiring on the normal startTime + duration deadline.
ALTER TABLE "TestAttempt" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
