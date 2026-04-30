 import { useSync } from '../hooks/useSync';

export default function SyncStatus() {
  const { isOnline, isSyncing, lastSync, pendingCount, syncError, performSync } = useSync();

  return (
    <div className="fixed bottom-4 right-4 p-4 bg-white rounded-lg shadow-lg border max-w-xs">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-sm font-medium">
          {isOnline ? 'Online' : 'Offline - Working Locally'}
        </span>
      </div>
      
      <div className="text-sm text-gray-600 space-y-1">
        <p>Pending sync: <span className="font-semibold">{pendingCount}</span> records</p>
        {lastSync && (
          <p className="text-xs">Last sync: {new Date(lastSync).toLocaleString('en-KE')}</p>
        )}
      </div>
      
      {syncError && (
        <p className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
          Error: {syncError}
        </p>
      )}
      
      <button
        onClick={performSync}
        disabled={!isOnline || isSyncing || pendingCount === 0}
        className="mt-3 w-full py-2 px-3 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {isSyncing ? 'Syncing...' : 'Sync Now'}
      </button>
    </div>
  );
}
