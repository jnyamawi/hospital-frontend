import { useState, useEffect, useCallback } from 'react';
import { db } from '../db/schema';

const API_BASE = 'http://localhost:8000';
const DEVICE_ID = db.getDeviceId();

const SYNC_PRIORITY = {
  'patients': 1,
  'encounters': 2,
  'patientJourney': 3,
  'bills': 4
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
      // Sort by priority
      let queue = await db.syncQueue.orderBy('timestamp').toArray();
      queue.sort((a, b) => (SYNC_PRIORITY[a.table_name] || 99) - (SYNC_PRIORITY[b.table_name] || 99));
      
      console.log('=== SYNC START ===');
      console.log('Queue items:', queue.length);
      
      for (const job of queue) {
        const table = db[job.table_name];
        
        // SPECIAL: patientJourney lookup by patient_local_id, not id
        let record;
        if (job.table_name === 'patientJourney') {
          record = await table
            .where('patient_local_id')
            .equals(job.local_id)
            .first();
        } else {
          record = await table.get(job.local_id);
        }
        
        console.log(`Processing: ${job.table_name} - ${job.local_id}`);
        
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
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
          }
          
          const serverRecord = await response.json();
          console.log(`✓ Synced: ${job.table_name} -> server_id: ${serverRecord.server_id}`);
          
          // SPECIAL: patientJourney update by id, not patient_local_id
          if (job.table_name === 'patientJourney') {
            await table.update(record.id, {
              server_id: serverRecord.server_id,
              sync_status: 'synced',
              version: serverRecord.version,
              updated_at: serverRecord.updated_at
            });
          } else {
            await table.update(job.local_id, {
              server_id: serverRecord.server_id,
              sync_status: 'synced',
              version: serverRecord.version,
              updated_at: serverRecord.updated_at
            });
          }
          
          await db.syncQueue.delete(job.id);
          
        } catch (err) {
          console.error(`✗ Failed to sync ${job.table_name}:`, err.message);
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
        }
      }
      
      // PULL from server
      const lastSyncTime = lastSync || '1970-01-01T00:00:00Z';
      console.log('Pulling since:', lastSyncTime);
      
      const pullResponse = await fetch(
        `${API_BASE}/sync/pull?since=${encodeURIComponent(lastSyncTime)}&device=${DEVICE_ID}`
      );
      
      if (pullResponse.ok) {
        const changes = await pullResponse.json();
        console.log('=== PULLED FROM SERVER ===');
        console.log('Number of changes:', changes.length);
        
        for (const change of changes) {
          console.log(`- ${change.table}: ${change.local_id}`);
          
          // Handle table name mapping
          let tableName = change.table;
          if (tableName === 'patientJourneys' || tableName === 'patient_journeys') {
            tableName = 'patientJourney';
          }
          
          const table = db[tableName];
          if (!table) {
            console.error('Unknown table:', tableName, '(original:', change.table + ')');
            continue;
          }
          
          // SPECIAL handling for patientJourney
          if (tableName === 'patientJourney') {
            const patientLocalId = change.local_id || change.data.patient_local_id;
            const existing = await table
              .where('patient_local_id')
              .equals(patientLocalId)
              .first();
            
            if (!existing) {
              await table.add({ 
                ...change.data, 
                sync_status: 'synced',
                created_at: change.data.created_at || new Date().toISOString(),
                updated_at: change.data.updated_at || new Date().toISOString()
              });
              console.log(`  ✓ Added new patientJourney for ${patientLocalId}`);
            } else {
              await table.update(existing.id, { 
                ...change.data, 
                sync_status: 'synced',
                updated_at: change.data.updated_at || new Date().toISOString()
              });
              console.log(`  ✓ Updated patientJourney for ${patientLocalId}`);
            }
          } else {
            // Normal handling for patients, encounters, bills
            const localRecord = await table.get(change.local_id);
            
            if (!localRecord) {
              await table.add({ ...change.data, sync_status: 'synced' });
              console.log(`  ✓ Added new ${tableName}`);
            } else if (localRecord.version < change.data.version) {
              await table.put({ ...change.data, sync_status: 'synced' });
              console.log(`  ✓ Updated ${tableName}`);
            } else {
              console.log(`  → Already up to date`);
            }
          }
        }
      } else {
        console.error('Pull failed:', pullResponse.status);
      }
      
      const now = new Date().toISOString();
      await db.meta.put({ key: 'last_sync', value: now });
      setLastSync(now);
      console.log('=== SYNC COMPLETE ===');
      
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