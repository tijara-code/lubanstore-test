/**
 * The admin area's housekeeping: the audit trail is kept 180 days (the original's
 * purge_admin_audit, run by its hourly sweep). Daily.
 */
import { defineJob } from "../../jobs";
import { AUDIT_DAYS, purgeAudit } from "./audit";

defineJob("admin-audit", 1440, async (deps) => ({ purged: await purgeAudit(deps, AUDIT_DAYS), days: AUDIT_DAYS }));

export {};
