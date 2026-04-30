 import { useState } from 'react';
import { db } from '../db/schema';

export default function PatientForm({ onSuccess }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    
    const form = e.target;
    const localId = db.generateTempId('PT');
    const deviceId = db.getDeviceId();
    const now = new Date().toISOString();

    const patient = {
      local_id: localId,
      server_id: null,
      national_id: form.national_id.value || null,
      phone: form.phone.value,
      name: form.name.value.trim().toUpperCase(),
      dob: form.dob.value || null,
      gender: form.gender.value,
      county: form.county.value,
      sub_county: form.sub_county.value,
      facility_code: localStorage.getItem('facility_code') || 'DEMO-FAC-001',
      created_at: now,
      updated_at: now,
      sync_status: 'pending',
      device_id: deviceId,
      version: 1
    };

    try {
      await db.patients.add(patient);
      await db.queueForSync('patients', localId, 'push');
      
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        form.reset();
        onSuccess?.(patient);
      }, 1500);
    } catch (err) {
      alert('Error saving: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-4 bg-white rounded shadow">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Register Patient (Offline)</h2>
      
      {saved && (
        <div className="mb-4 p-3 bg-green-100 text-green-800 rounded text-sm">
          ✓ Saved locally. Will sync when online.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Full Name *</label>
          <input name="name" required 
            className="w-full mt-1 p-2 border rounded focus:ring-2 focus:ring-blue-500" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">National ID</label>
            <input name="national_id" 
              className="w-full mt-1 p-2 border rounded" 
              placeholder="Optional" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Phone *</label>
            <input name="phone" required type="tel"
              className="w-full mt-1 p-2 border rounded" 
              placeholder="07XX XXX XXX" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">Date of Birth</label>
            <input name="dob" type="date"
              className="w-full mt-1 p-2 border rounded" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Gender *</label>
            <select name="gender" required
              className="w-full mt-1 p-2 border rounded">
              <option value="">Select</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="O">Other</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">County</label>
            <input name="county" 
              className="w-full mt-1 p-2 border rounded" 
              defaultValue="Murang'a" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Sub-County</label>
            <input name="sub_county" 
              className="w-full mt-1 p-2 border rounded" />
          </div>
        </div>

        <button 
          type="submit" 
          disabled={saving}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {saving ? 'Saving...' : 'Save Patient (Offline)'}
        </button>
      </form>
    </div>
  );
}
