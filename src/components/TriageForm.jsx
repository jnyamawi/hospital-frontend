import { useState, useEffect } from 'react';
import { db } from '../db/schema';

export default function TriageForm() {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [currentNurseId, setCurrentNurseId] = useState('');

  useEffect(() => {
    loadPatients();
    const interval = setInterval(() => {
      loadPatients();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const nurseId = localStorage.getItem('user_staff_id') || 'UNKNOWN';
    setCurrentNurseId(nurseId);
  }, []);

  const loadPatients = async () => {
    const waitingPatients = await db.getPatientsForStage('triage');
    setPatients(waitingPatients);
  };

  const handleSelectPatient = async (patient) => {
    const nurseId = currentNurseId || localStorage.getItem('user_staff_id') || 'UNKNOWN';
    
    // If already locked by me, just open it (no need to re-lock)
    if (patient.journey?.locked_by === nurseId) {
      setSelectedPatient(patient);
      return;
    }
    
    // Try to lock the patient
    const locked = await db.lockPatient(patient.local_id, nurseId);
    
    if (!locked) {
      await loadPatients();
      setMessage(`Patient ${patient.name} is already being seen by ${patient.journey.locked_by}`);
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    
    setSelectedPatient(patient);
    if (window.syncHook?.performSync) {
      await window.syncHook.performSync();
    }
  };

  const handleBack = async () => {
    if (selectedPatient) {
      await db.unlockPatient(selectedPatient.local_id);
      if (window.syncHook?.performSync) {
        await window.syncHook.performSync();
      }
    }
    setSelectedPatient(null);
    setSelectedDestination(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatient || !selectedDestination) return;

    const form = e.target;
    const localId = db.generateTempId('ENC-TRI');
    const deviceId = db.getDeviceId();
    const now = new Date().toISOString();

    const encounter = {
      local_id: localId,
      server_id: null,
      patient_local_id: selectedPatient.local_id,
      encounter_type: 'triage',
      parent_encounter_id: selectedPatient.lastEncounter?.local_id || null,
      vitals_json: JSON.stringify({
        bp: form.bp.value,
        temp: parseFloat(form.temp.value),
        weight: parseFloat(form.weight.value),
        spo2: parseInt(form.spo2.value),
        pulse: parseInt(form.pulse.value)
      }),
      chief_complaint: form.complaint.value,
      priority: form.priority.value,
      notes: `Sent to ${selectedDestination.toUpperCase()} after triage`,
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
      await db.queueForSync('encounters', localId, 2);
      
      await db.completeStage(
        selectedPatient.local_id,
        selectedDestination
      );
      
      if (window.syncHook?.performSync) {
        await window.syncHook.performSync();
      }
      
      setSaved(true);
      setMessage(`✓ ${selectedPatient.name} triaged and sent to ${selectedDestination.toUpperCase()}!`);
      
      setTimeout(() => {
        setSaved(false);
        setSelectedPatient(null);
        setSelectedDestination(null);
        loadPatients();
      }, 2000);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  const getStatusDisplay = (patient) => {
    const journey = patient.journey;
    const isLockedByMe = journey.locked_by === currentNurseId;
    
    // Patient is locked by SOMEONE ELSE
    if (journey.status === 'in-progress' && journey.locked_by && !isLockedByMe) {
      return {
        text: `Being seen by ${journey.locked_by}`,
        class: 'bg-orange-100 text-orange-800',
        disabled: true,
        borderColor: 'border-gray-300'
      };
    }
    
    // Patient is locked by ME (I can continue working)
    if (journey.status === 'in-progress' && journey.locked_by && isLockedByMe) {
      return {
        text: 'Continue Triage 🔒',
        class: 'bg-blue-100 text-blue-800',
        disabled: false,
        borderColor: 'border-blue-500'
      };
    }
    
    if (journey.status === 'waiting') {
      return {
        text: 'Select',
        class: 'bg-blue-100 text-blue-800',
        disabled: false,
        borderColor: 'border-blue-500'
      };
    }
    
    return {
      text: journey.status,
      class: 'bg-gray-100 text-gray-800',
      disabled: true,
      borderColor: 'border-gray-300'
    };
  };

  const getPriorityColor = (priority) => {
    const colors = {
      red: 'bg-red-100 text-red-800 border-red-300',
      yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      green: 'bg-green-100 text-green-800 border-green-300'
    };
    return colors[priority] || colors.green;
  };

  const parseVitals = (json) => {
    try { return JSON.parse(json || '{}'); } catch { return {}; }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Triage - Patient Vitals & Routing</h2>
      
      {message && (
        <div className={`mb-4 p-3 rounded text-sm ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}

      {!selectedPatient ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">Patients checked in at reception waiting for triage:</p>
          <div className="space-y-2">
            {patients.length === 0 && (
              <p className="text-gray-500 text-center py-8">No patients waiting for triage.</p>
            )}
            {patients.map(p => {
              const status = getStatusDisplay(p);
              return (
                <button
                  key={p.local_id}
                  onClick={() => !status.disabled && handleSelectPatient(p)}
                  disabled={status.disabled}
                  className={`w-full p-4 bg-white rounded shadow border-l-4 text-left transition-all ${
                    status.disabled 
                      ? `${status.borderColor} opacity-60 cursor-not-allowed` 
                      : `${status.borderColor} hover:bg-blue-50 cursor-pointer`
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-lg">{p.name}</div>
                      <div className="text-sm text-gray-600">
                        ID: {p.local_id} | {p.gender} | {p.phone}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Checked in: {new Date(p.journey?.updated_at || p.created_at).toLocaleTimeString('en-KE')}
                      </div>
                      {p.journey?.locked_by && p.journey.locked_by !== currentNurseId && (
                        <div className="text-xs text-orange-600 mt-1 font-medium">
                          🔒 Being attended by: {p.journey.locked_by}
                        </div>
                      )}
                      {p.journey?.locked_by && p.journey.locked_by === currentNurseId && (
                        <div className="text-xs text-blue-600 mt-1 font-medium">
                          🔒 You are attending this patient
                        </div>
                      )}
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${status.class}`}>
                      {status.text}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : !selectedDestination ? (
        <div className="bg-white rounded shadow p-6">
          <div className="mb-4 p-3 bg-blue-50 rounded flex justify-between items-center">
            <div>
              <div className="font-bold">{selectedPatient.name}</div>
              <div className="text-sm text-gray-600">{selectedPatient.phone} | {selectedPatient.gender}</div>
            </div>
            <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs">
              🔒 Locked by you
            </span>
          </div>
          
          <h3 className="font-semibold mb-4 text-center">Where should this patient go?</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setSelectedDestination('lab')}
              className="p-6 bg-indigo-50 border-2 border-indigo-200 rounded-lg hover:bg-indigo-100 hover:border-indigo-400 text-center"
            >
              <div className="text-3xl mb-2">🧪</div>
              <div className="font-bold text-indigo-800">Send to LAB</div>
              <div className="text-xs text-indigo-600 mt-1">Blood tests, imaging, etc.</div>
            </button>
            
            <button
              onClick={() => setSelectedDestination('consultation')}
              className="p-6 bg-green-50 border-2 border-green-200 rounded-lg hover:bg-green-100 hover:border-green-400 text-center"
            >
              <div className="text-3xl mb-2">👨‍⚕️</div>
              <div className="font-bold text-green-800">Send to DOCTOR</div>
              <div className="text-xs text-green-600 mt-1">Direct consultation</div>
            </button>
          </div>
          
          <button
            onClick={handleBack}
            className="w-full mt-4 py-2 text-gray-600 hover:text-gray-800"
          >
            ← Back to Patient List (Unlock Patient)
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-4 p-3 bg-yellow-50 rounded flex justify-between items-center">
            <div>
              <div className="font-bold">{selectedPatient.name}</div>
              <div className="text-sm text-gray-600">
                Routing to: <span className="font-semibold text-indigo-700">{selectedDestination.toUpperCase()}</span>
              </div>
            </div>
            <button 
              onClick={() => setSelectedDestination(null)}
              className="text-sm text-blue-600 hover:underline"
            >
              Change Destination
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
              className="w-full py-3 bg-yellow-600 text-white rounded hover:bg-yellow-700 font-medium"
            >
              Save Triage & Send to {selectedDestination.toUpperCase()}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}