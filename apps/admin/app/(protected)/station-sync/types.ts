// Types extracted from actions.ts so the 'use server' file only exports async
// functions. Re-exporting types from a server-action file confuses Turbopack
// and crashes module evaluation at runtime — see story 4.7 hotfix.

export interface SyncStatusResult {
  status: 'idle' | 'running' | 'failed';
  lastCompletedAt: string | null;
  lastFailedAt: string | null;
  stationCount: number;
}
