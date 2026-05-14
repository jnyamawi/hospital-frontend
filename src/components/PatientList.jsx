import { useState, useEffect } from 'react';
import { db } from '../db/schema';

export default function PatientList() {
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    loadPatients();
  }, [search, filter]);

  const loadPatients = async () => {
    let query = db.patients.orderBy('updated_at').reverse();
    
    if (search) {
      query = db.patients.where('name').startsWithIgnoreCase(search.toUpperCase());
    }
    
    const all = await query.toArray();
    
    const filtered = filter === 'all' 
      ? all 
      : all.filter(p => p.sync_status === filter);
    
    setPatients(filtered);
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      synced: 'bg-green-100 text-green-800',
      conflict: 'bg-red-100 text-red-800'
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Patient Records</h2>
      
      <div className="flex gap-3 mb-4">
        <input 
          type="text" 
          placeholder="Search by name..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 p-2 border rounded"
        />
        <select 
          value={filter} 
          onChange={(e) => setFilter(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="all">All</option>
          <option value="pending">Pending Sync</option>
          <option value="synced">Synced</option>
        </select>
      </div>

      <div className="space-y-2">
        {patients.length === 0 && (
          <p className="text-gray-500 text-center py-8">No patients found.</p>
        )}
        
        {patients.map(p => (
          <div key={p.local_id} className="p-3 bg-white rounded shadow border-l-4 border-blue-500">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-gray-900">{p.name}</h3>
                <p className="text-sm text-gray-600">
                  ID: {p.local_id} {p.national_id && `| National: ${p.national_id}`}
                </p>
                <p className="text-sm text-gray-600">
                  {p.gender} | {p.phone} | {p.county}
                </p>
              </div>
              <div className="text-right">
                {getStatusBadge(p.sync_status)}
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(p.updated_at).toLocaleString('en-KE')}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}