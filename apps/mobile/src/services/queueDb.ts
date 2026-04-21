import * as SQLite from 'expo-sqlite';
import type { FuelType } from '@desert/types';

const db = SQLite.openDatabaseSync('desert_queue.db');

// Auto-init at module load so any import (e.g. useQueueCount) is safe before
// the root layout's useEffect fires.
db.execSync(`
  CREATE TABLE IF NOT EXISTS capture_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_uri TEXT NOT NULL,
    fuel_type TEXT NOT NULL,
    manual_price REAL,
    preselected_station_id TEXT,
    gps_lat REAL,
    gps_lng REAL,
    captured_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  )
`);

/** No-op — table is created at module load. Kept so call sites remain self-documenting. */
export function initQueueDb(): void {}

export interface QueueRow {
  id: number;
  photo_uri: string;
  fuel_type: FuelType;
  manual_price: number | null;
  preselected_station_id: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  captured_at: string;
  status: 'pending' | 'failed';
  retry_count: number;
  next_retry_at: number | null;
}

export function insertQueueEntry(entry: {
  photoUri: string;
  fuelType: FuelType;
  manualPrice?: number;
  preselectedStationId?: string;
  gpsLat?: number;
  gpsLng?: number;
  capturedAt: string;
}): void {
  db.runSync(
    `INSERT INTO capture_queue (photo_uri, fuel_type, manual_price, preselected_station_id, gps_lat, gps_lng, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.photoUri,
      entry.fuelType,
      entry.manualPrice ?? null,
      entry.preselectedStationId ?? null,
      entry.gpsLat ?? null,
      entry.gpsLng ?? null,
      entry.capturedAt,
    ],
  );
}

/** Returns pending entries whose next_retry_at is due (or NULL = try immediately). */
export function getDueEntries(): QueueRow[] {
  return db.getAllSync<QueueRow>(
    `SELECT * FROM capture_queue
     WHERE status = 'pending'
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY created_at ASC`,
    [Date.now()],
  );
}

/** Upload succeeded — remove the entry from the queue. */
export function markSuccess(id: number): void {
  db.runSync(`DELETE FROM capture_queue WHERE id = ?`, [id]);
}

const BACKOFF_MS = [30_000, 120_000, 600_000] as const;

/** Transient failure — increment retry count and schedule next attempt. */
export function markRetry(id: number, retryCount: number): void {
  const delay = BACKOFF_MS[retryCount] ?? 600_000;
  db.runSync(
    `UPDATE capture_queue SET retry_count = ?, next_retry_at = ? WHERE id = ?`,
    [retryCount + 1, Date.now() + delay, id],
  );
}

/** Permanent failure — no more automatic retries. */
export function markFailed(id: number): void {
  db.runSync(`UPDATE capture_queue SET status = 'failed' WHERE id = ?`, [id]);
}

export function getPendingCount(): number {
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM capture_queue WHERE status = 'pending'`,
  );
  return row?.count ?? 0;
}

export function getFailedCount(): number {
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM capture_queue WHERE status = 'failed'`,
  );
  return row?.count ?? 0;
}

/**
 * One-off recovery: flip all `failed` entries back to `pending` with retry_count
 * reset, so they get another chance on the next processQueue tick. Intended for
 * the Story 3.11 fix — the old 401 bug permanently-failed submissions that were
 * actually just waiting on a token refresh. Safe to call repeatedly.
 */
export function unfailAllQueueEntries(): number {
  const result = db.runSync(
    `UPDATE capture_queue SET status = 'pending', retry_count = 0, next_retry_at = NULL
     WHERE status = 'failed'`,
  );
  return result.changes;
}
