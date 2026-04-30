import { useState, useEffect, useCallback } from 'react';
import { db } from '../db/schema';

const API_BASE = 'http://localhost:8000';
const DEVICE_ID = db.getDeviceId();

const SYNC_PRIORITY = {
  'patients': 1,
  'encounters': 2,
  'bills': 3
};

export function useSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncError, setSyncError] = useState(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    loadMeta();
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadMeta = async () => {
    const last = await db.meta.get('last_sync');
    setLastSync(last?.value || null);
    
    const pending = await db.syncQueue.count();
    setPendingCount(pending);
  };

  const performSync = useCallback(async () => {
    if (!isOnline || isSyncing) return;
    
    setIsSyncing(true);
    setSyncError(null);
    
    try {
      // Sort by priority: patients first, then encounters, then bills
      let queue = await db.syncQueue.orderBy('timestamp').toArray();
      queue.sort((a, b) => (SYNC_PRIORITY[a.table_name] || 99) - (SYNC_PRIORITY[b.table_name] || 99));
      
      for (const job of queue) {
        const table = db[job.table_name];
        const record = await table.get(job.local_id);
        
        if (!record || record.sync_status === 'synced') {
          await db.syncQueue.delete(job.id);
          continue;
        }
        
        try {
          const response = await fetch(`${API_BASE}/sync/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              table: job.table_name,
              record: record,
              device_id: DEVICE_ID
            })
          });
          
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          
          const serverRecord = await response.json();
          
          await table.update(job.local_id, {
            server_id: serverRecord.server_id,
            sync_status: 'synced',
            version: serverRecord.version,
            updated_at: serverRecord.updated_at
          });
          
          await db.syncQueue.delete(job.id);
          
        } catch (err) {
          if (job.retry_count >= 5) {
            await db.syncQueue.update(job.id, { 
              retry_count: job.retry_count + 1,
              last_error: err.message 
            });
          } else {
            await db.syncQueue.update(job.id, { 
              retry_count: (job.retry_count || 0) + 1 
            });
          }
          throw err;
        }
      }
      
      const lastSyncTime = lastSync || '1970-01-01T00:00:00Z';
      
      const pullResponse = await fetch(
        `${API_BASE}/sync/pull?since=${encodeURIComponent(lastSyncTime)}&device=${DEVICE_ID}`
      );
      
      if (pullResponse.ok) {
        const changes = await pullResponse.json();
        
        for (const change of changes) {
          const table = db[change.table];
          const localRecord = await table.get(change.local_id);
          
          if (!localRecord) {
            await table.add({ ...change.data, sync_status: 'synced' });
          } else if (localRecord.version < change.data.version) {
            await table.put({ ...change.data, sync_status: 'synced' });
          }
        }
      }
      
      const now = new Date().toISOString();
      await db.meta.put({ key: 'last_sync', value: now });
      setLastSync(now);
      
    } catch (err) {
      setSyncError(err.message);
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
      await loadMeta();
    }
  }, [isOnline, isSyncing, lastSync]);

  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      performSync();
    }
  }, [isOnline, pendingCount, performSync]);

  return {
    isOnline,
    isSyncing,
    lastSync,
    pendingCount,
    syncError,
    performSync
  };
}