 import { useState, useEffect } from 'react';
import { db } from '../db/schema';

export default function TriageForm() {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    const needingTriage = await db.getPatientsNeedingTriage();
    setPatients(needingTriage);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatient) return;

    const form = e.target;
    const localId = db.generateTempId('ENC-TRI');
    const deviceId = db.getDeviceId();
    const now = new Date().toISOString();

    const encounter = {
      local_id: localId,
      server_id: null,
      patient_local_id: selectedPatient.local_id,
      encounter_type: 'triage',
      parent_encounter_id: null,
      vitals_json: JSON.stringify({
        bp: form.bp.value,
        temp: parseFloat(form.temp.value),
        weight: parseFloat(form.weight.value),
        spo2: parseInt(form.spo2.value),
        pulse: parseInt(form.pulse.value)
      }),
      chief_complaint: form.complaint.value,
      priority: form.priority.value,
      department_code: 'TRI-01',
      facility_code: localStorage.getItem('facility_code') || 'DEMO-FAC-001',
      clinician_id: form.nurse_id.value,
      created_at: now,
      updated_at: now,
      sync_status: 'pending',
      device_id: deviceId,
      version: 1
    };

    try {
      await db.encounters.add(encounter);
      await db.queueForSync('encounters', localId, 2); // Priority 2
      
      setSaved(true);
      setSelectedPatient(null);
      setTimeout(() => {
        setSaved(false);
        loadPatients(); // Refresh list
      }, 1500);
    } catch (err) {
      alert('Error saving triage: ' + err.message);
    }
  };

  const getPriorityColor = (priority) => {
    const colors = {
      red: 'bg-red-100 text-red-800 border-red-300',
      yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      green: 'bg-green-100 text-green-800 border-green-300'
    };
    return colors[priority] || colors.green;
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Triage - Patient Vitals</h2>
      
      {saved && (
        <div className="mb-4 p-3 bg-green-100 text-green-800 rounded text-sm">
          ✓ Triage saved locally. Will sync when online.
        </div>
      )}

      {!selectedPatient ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">Select a patient registered today who needs triage:</p>
          <div className="space-y-2">
            {patients.length === 0 && (
              <p className="text-gray-500 text-center py-8">No patients waiting for triage.</p>
            )}
            {patients.map(p => (
              <button
                key={p.local_id}
                onClick={() => setSelectedPatient(p)}
                className="w-full p-3 bg-white rounded shadow border-l-4 border-blue-500 text-left hover:bg-blue-50"
              >
                <div className="font-semibold">{p.name}</div>
                <div className="text-sm text-gray-600">{p.phone} | {p.gender} | {p.county}</div>
                <div className="text-xs text-gray-500 mt-1">Registered: {new Date(p.created_at).toLocaleTimeString('en-KE')}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-4 p-3 bg-blue-50 rounded flex justify-between items-center">
            <div>
              <div className="font-semibold">{selectedPatient.name}</div>
              <div className="text-sm text-gray-600">{selectedPatient.phone}</div>
            </div>
            <button 
              onClick={() => setSelectedPatient(null)}
              className="text-sm text-blue-600 hover:underline"
            >
              Change Patient
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Blood Pressure *</label>
                <input name="bp" required placeholder="120/80"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Temperature (°C) *</label>
                <input name="temp" required type="number" step="0.1" placeholder="37.0"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Weight (kg)</label>
                <input name="weight" type="number" step="0.1"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">SpO2 (%)</label>
                <input name="spo2" type="number"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Pulse (bpm)</label>
                <input name="pulse" type="number"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Chief Complaint *</label>
              <textarea name="complaint" required rows="2"
                className="w-full mt-1 p-2 border rounded"
                placeholder="Patient's main complaint..."></textarea>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Priority *</label>
                <select name="priority" required
                  className="w-full mt-1 p-2 border rounded">
                  <option value="green">Green - Stable</option>
                  <option value="yellow">Yellow - Urgent</option>
                  <option value="red">Red - Emergency</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Nurse ID *</label>
                <input name="nurse_id" required
                  className="w-full mt-1 p-2 border rounded"
                  placeholder="NURSE-001" />
              </div>
            </div>

            <button 
              type="submit"
              className="w-full py-2 px-4 bg-yellow-600 text-white rounded hover:bg-yellow-700 font-medium"
            >
              Save Triage & Send to Doctor
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
