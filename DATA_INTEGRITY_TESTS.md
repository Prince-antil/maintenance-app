# Data Integrity Test Suite

This document outlines comprehensive tests for verifying the fixes to 5 data integrity issues:

1. **PROBLEM 1 — BREAKDOWN BULK IMPORT DUPLICATION**: 27 rows → 155 records
2. **PROBLEM 2 — PM_LOGS SCHEMA ERROR**: Missing 'period' column
3. **PROBLEM 3 — STALE QUEUE**: Old operations replayed indefinitely
4. **PROBLEM 4 — DELETE + REIMPORT**: Deleted records re-added by Realtime
5. **PROBLEM 5 — DATA INTEGRITY**: Overall consistency

---

## Root Causes & Solutions

### Issue 1: 27→155 Multiplication

**Root Causes:**
- `importMachineBreakdownLogsBulk` prepended new logs to state without checking for stable key duplicates
- Excel rows weren't deduplicated within the file itself
- Unmatched machines (machineId='') all collapsed into one key prefix `":st:..."`, bypassing dedup
- Realtime events fired for each Supabase insert, calling `applyRealtimePayload` which added records AGAIN
- Stale queue replayed old upserts for the same records with different IDs

**Solution:**
- Define stable key: `machineId|date|startTime|endTime`
- Fallback unmatched machines to their machineCode/machineName so each gets a unique key
- Deduplicate within Excel (keep last occurrence)
- Deduplicate against store (upsert if key exists, insert if new)
- Reuse existing record IDs for updates
- Add unique constraint to DB to enforce at storage layer
- Stale queue now purges ops older than 72h

### Issue 2: PM_LOGS Period Column Missing

**Root Cause:**
- `cloud_sync_schema.sql` (applied first) had the full table definition with `period` column
- But `pmToCloudRow` was sending `period: record.period` while `resolvePeriod` computes it
- If the column didn't exist in DB, upsert would fail silently

**Solution:**
- Migration adds `period` column to pm_logs (IF NOT EXISTS)
- `pmToCloudRow` now computes period via `resolvePeriod()` to ensure it's always present

### Issue 3: Stale Queue

**Root Cause:**
- `queueCloudMutation` replaced same-recordId ops but never expired old ones
- After delete+reimport with new record IDs, old delete ops accumulated indefinitely

**Solution:**
- Define `QUEUE_OP_MAX_AGE_MS = 72 * 60 * 60 * 1000` (72 hours)
- `queueCloudMutation` now filters stale ops before adding new op
- `flushPendingCloudOps` drops stale ops before attempting to push
- `clearObsoleteQueuedMutations()` export allows manual cleanup

### Issue 4: Delete + Reimport

**Root Cause:**
- After deleting records, Realtime subscription could fire again for the same data
- Queue didn't clear delete operations, so stale deletes could be replayed

**Solution:**
- `deleteMachineBreakdownLog` now calls `dropPendingCloudOpsForRecord` to clear queue
- Stable key ensures re-imported records with same key upsert to existing rows (not new ones)

---

## Test Cases

### A. Empty Database + Import 27 Rows → Expect 27

```
Pre-condition: machine_breakdown_logs table is empty
Action:       Import Excel with 27 rows for a single machine (MC-101)
Expected:     machineBreakdownLogs state length = 27
              Supabase machine_breakdown_logs table = 27 rows
              importResult.finalUnique = 27
              importResult.imported = 27, updated = 0, skippedDuplicates = 0
```

### B. Import Same 27 Rows Again → Expect Still 27

```
Pre-condition: state has 27 breakdown logs (from test A)
Action:       Re-import same Excel file (27 identical rows)
Expected:     machineBreakdownLogs state length = 27 (unchanged)
              importResult.finalUnique = 27
              importResult.imported = 0, updated = 27, skippedDuplicates = 0
              (Each row upserts to its existing ID via stable key)
```

### C. Delete All 27 → Expect 0

```
Pre-condition: state has 27 breakdown logs
Action:       Call deleteMachineBreakdownLog for each record
Expected:     machineBreakdownLogs state length = 0
              Queue should be cleared for each deleted record
              Supabase table = 0 rows
              No lingering delete ops in localStorage
```

### D. Import 27 After Delete → Expect Exactly 27

```
Pre-condition: state has 0 breakdown logs (from test C)
Action:       Re-import same Excel file (27 rows)
Expected:     machineBreakdownLogs state length = 27
              importResult.finalUnique = 27
              importResult.imported = 27 (all new records)
              No duplicates from old records
```

### E. Import 5 Modified Rows → Expect 27 Total, 5 Updated

```
Pre-condition: state has 27 breakdown logs (from test D)
              Excel has 27 rows, but 5 have different failure_cause
Action:       Re-import Excel with 5 rows modified
Expected:     machineBreakdownLogs state length = 27 (unchanged)
              importResult.imported = 0
              importResult.updated = 5
              importResult.finalUnique = 27
              5 records should reflect new failure_cause values
```

### F. Excel with Duplicate Rows Within File → Duplicates Rejected

```
Pre-condition: Empty database
Action:       Import Excel with 10 rows, but 5 are exact duplicates (same machine/date/times)
Expected:     machineBreakdownLogs state length = 5
              importResult.imported = 5
              importResult.skippedDuplicates = 5
              Only one row per stable key is imported
```

### G. Realtime Reconnect → No Duplicate Records

```
Pre-condition: state has 27 breakdown logs (synced to Supabase)
Action:       1. Stop Realtime subscription
              2. Wait 5 seconds
              3. Restart Realtime subscription
              4. Wait for full sync
Expected:     machineBreakdownLogs state length = 27 (unchanged)
              No new records appear
              Each record ID is unique
```

### H. Browser Refresh → No Duplicate Records

```
Pre-condition: state has 27 breakdown logs (synced to Supabase)
Action:       1. Hard refresh the browser page (Ctrl+Shift+R)
              2. Wait for localStorage restore + cloud sync
Expected:     machineBreakdownLogs state length = 27
              Store loads from localStorage then syncs with Supabase
              No new records appear
              Section summaries recalculated correctly
```

### I. Section Summaries Remain Correct

```
Pre-condition: 27 breakdown logs for section "Herbi EC Packaging", period "2026-08"
              state.breakdowns has one summary for this section/period
Action:       Various import/update/delete operations from tests A–H
Expected:     breakdowns[0].breakdownCount = count of bd logs for that section+period
              breakdowns[0].downtimeHours = sum of downtime_hours for those logs
              MTTR, MTBF auto-calculated correctly
              Available hours / availability % correct
```

### J. Machine Profile Shows Only That Machine's Records

```
Pre-condition: Imported 27 logs for MC-101
              Also imported 15 logs for MC-102
Action:       Open Machine Profile for MC-101
Expected:     getMachineBreakdownLogsForMachine('MC-101').length = 27
              getMachineBreakdownLogsForMachine('MC-102').length = 15
              No cross-machine data leakage
```

### K. PM Logs Period Column Exists & Syncs

```
Pre-condition: Database has pm_logs table
Action:       1. Add PM summary via store.addPM() for 2026-08
              2. Verify pmToCloudRow sends period = '2026-08'
              3. Upsert to Supabase
              4. Fetch back via Realtime
Expected:     DB row has period = '2026-08'
              No "could not find the 'period' column" errors
              Realtime event fires and updates local state
              normalizePMCloudRow correctly deserializes
```

### L. Stale Queue Operations Age Out

```
Pre-condition: Manually create a queued operation with queuedAt = 90 hours ago
Action:       Call queueCloudMutation (any entity/action)
              Wait for flush to attempt
Expected:     Old operation is filtered out during queueCloudMutation
              Old operation is dropped before flush
              clearObsoleteQueuedMutations() reports 1 removed
              Queue length decreases
```

### M. Delete Operations Clear Queue

```
Pre-condition: Queue has pending upsert for BD log ID 'bdl-123'
Action:       Call deleteMachineBreakdownLog('bdl-123', 'Admin')
Expected:     dropPendingCloudOpsForRecord('machineBreakdownLogs', 'bdl-123')
              Queue entry for bdl-123 is removed
              No orphaned delete op lingers in queue
```

### N. Unmatched Machines Don't Collapse Keys

```
Pre-condition: Import Excel with 3 rows:
               - Row 1: Machine "PUMP-01" (unmatched)
               - Row 2: Machine "PUMP-02" (unmatched)
               - Row 3: Machine "PUMP-01" again (same data)
Action:       Import Excel
Expected:     importResult.imported = 2 (PUMP-01 first, PUMP-02)
              importResult.skippedDuplicates = 1 (PUMP-01 duplicate within file)
              Two separate records created (not collapsed)
              machineCode field preserved for unmatched rows
```

### O. Breakdown MTTR/MTBF Auto-calculated

```
Pre-condition: Empty database
Action:       Import 5 breakdown logs for MC-101, 2026-08:
               - Log 1: downtime_hours = 2.5
               - Log 2: downtime_hours = 1.5
               - Log 3: downtime_hours = 3.0
               - Log 4: downtime_hours = 2.0
               - Log 5: downtime_hours = 1.0
Expected:     Supabase breakdown_logs[0] (2026-08, MC-101's section):
               - total_breakdowns = 5
               - downtime_hours = 10.0
               - mttr = 10.0 / 5 = 2.0
               - mtbf auto-calculated from operating_hours
              No manual MTTR entry required
```

---

## Implementation Notes

### For Frontend QA / Testing

1. **Enable Debug Logging**: Set `VITE_REALTIME_DEBUG=true` in `.env` to see detailed Realtime logs
2. **Use Browser DevTools**: Check localStorage for `CCPL_CLOUD_SYNC_QUEUE` key to inspect queue
3. **Network Throttling**: Use Chrome DevTools network tab to simulate slow/offline scenarios
4. **Hard Refresh**: Ctrl+Shift+R clears browser cache and forces localStorage restore

### For Backend Validation

1. **Run Migration**: Apply `20260813_fix_data_integrity.sql` to Supabase
2. **Verify Schema**: Check `pg_stat_user_tables` for row counts after each test
3. **Check Constraints**: Query `information_schema.table_constraints` to verify unique constraints
4. **Audit Logs**: Monitor Postgres logs for constraint violations or slow queries

### For Automation

Tests can be automated in a Cypress/Playwright suite:
- Mock machine store data
- Mock Supabase responses
- Test import flow end-to-end
- Assert store state before/after each operation
- Verify localStorage and queue state

---

## Expected Build & Deployment Results

After these fixes:

- ✅ **No 27→155 duplication** when importing same Excel twice
- ✅ **PM logs upserts succeed** without "period column not found" errors
- ✅ **Stale queue auto-purges** after 72 hours
- ✅ **Delete+reimport works correctly** with exact record count
- ✅ **Realtime reconnect doesn't duplicate** records
- ✅ **Browser refresh doesn't duplicate** records
- ✅ **Section summaries stay accurate** across all operations
- ✅ **Machine Profile shows only that machine's data**

---

## Rollback Plan

If issues arise in production:

1. **Revert migration**: Delete `20260813_fix_data_integrity.sql` from applied migrations
2. **Revert code**: Revert client/src/store.js to previous commit
3. **Clear queue**: Run `clearObsoleteQueuedMutations()` in browser console for affected users
4. **Restart Realtime**: Tear down and restart the Realtime subscription

---

## Files Changed

- `client/src/store.js` — Fixed importMachineBreakdownLogsBulk, stale queue, delete handler
- `supabase/migrations/20260813_fix_data_integrity.sql` — New migration
- `schema.sql` — Updated with unique constraint on machine_breakdown_logs

---

## Verification Checklist

Before deploying to production:

- [ ] All 15 test cases (A–O) pass locally
- [ ] Migration runs cleanly on staging Supabase
- [ ] npm build completes without errors
- [ ] No console warnings in browser DevTools
- [ ] Realtime events fire within 300ms (check via rtLog)
- [ ] Queue clears successfully for stale ops
- [ ] Dashboard/ORM/PM/Breakdowns/MachineProfile pages load correctly
- [ ] Analytics calculations (MTTR/MTBF/availability) match expected values
- [ ] Team member on secondary PC confirms cross-device sync works

---
