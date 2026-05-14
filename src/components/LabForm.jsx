import { useState, useEffect, useCallback } from 'react';
import { db } from '../db/schema';

export default function LabForm() {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [message, setMessage] = useState('');
  const [currentTechId, setCurrentTechId] = useState('');
  const [isReady, setIsReady] = useState(false); // ← NEW: track readiness

  const loadPatients = useCallback(async () => {
    const labPatients = await db.getPatientsForStage('lab');
    
    // CRITICAL: Skip auto-unlock if we don't know who we are yet
    if (!currentTechId || currentTechId === 'UNKNOWN') {
      console.log('LabForm: Not ready yet, skipping auto-unlock');
      setPatients(labPatients);
      return;
    }

    // Auto-unlock stale locks from PREVIOUS stages only
    let unlockedAny = false;
    for (const patient of labPatients) {
      const lock = patient.journey?.locked_by;
      
      // A lock is "stale" if:
      // 1. It exists
      // 2. It's NOT me
      // 3. It's NOT another lab tech (same department)
      // 4. It's from a previous stage (triage, doctor, etc.)
      const isMyLock = lock === currentTechId;
      const isAnotherLabTech = lock && (lock.startsWith('LAB') || lock.startsWith('TECH'));
      const isStaleLock = lock && !isMyLock && !isAnotherLabTech && lock !== 'UNKNOWN';
      
      if (isStaleLock) {
        console.log(`LabForm: Auto-unlocking ${patient.name} from ${lock} (stale lock)`);
        await db.unlockPatient(patient.local_id);
        unlockedAny = true;
      }
    }
    
    if (unlockedAny) {
      // Sync to push unlocks to server
      if (window.syncHook?.performSync) {
        await window.syncHook.performSync();
      }
      // Reload fresh data
      const freshPatients = await db.getPatientsForStage('lab');
      setPatients(freshPatients);
    } else {
      setPatients(labPatients);
    }
  }, [currentTechId]);

  // CRITICAL: Step 1 - Get techId FIRST
  useEffect(() => {
    const techId = localStorage.getItem('user_staff_id') || 'UNKNOWN';
    console.log('LabForm: My staff_id is:', techId);
    setCurrentTechId(techId);
    setIsReady(true); // ← Mark as ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CRITICAL: Step 2 - Only load patients AFTER we have techId
  useEffect(() => {
    if (!isReady) return; // ← Don't run until techId is set

    const init = async () => {
      await loadPatients();
      
      // Sync on mount
      if (window.syncHook && window.syncHook.performSync) {
        console.log('LabForm: Syncing on mount...');
        await window.syncHook.performSync();
        await loadPatients(); // Reload after sync
      }
    };
    
    init();

    // Auto-refresh every 2 seconds for better responsiveness
    const refreshInterval = setInterval(() => {
      loadPatients();
    }, 2000);

    return () => clearInterval(refreshInterval);
  }, [isReady, loadPatients]); // ← Include loadPatients in dependencies

  const handleSelectPatient = async (patient) => {
    const techId = currentTechId || localStorage.getItem('user_staff_id') || 'UNKNOWN';
    
    // Force a sync to get latest data before attempting to lock
    if (window.syncHook?.performSync) {
      console.log('LabForm: Syncing before locking patient...');
      await window.syncHook.performSync();
      await loadPatients(); // Refresh with latest data
    }
    
    // Re-check the patient data after sync
    const updatedPatient = patients.find(p => p.local_id === patient.local_id);
    if (!updatedPatient) {
      setMessage('Patient not found. Please refresh the page.');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    
    // If already locked by me, just open it
    if (updatedPatient.journey?.locked_by === techId) {
      setSelectedPatient(updatedPatient);
      return;
    }
    
    // If locked by someone else, show message
    if (updatedPatient.journey?.locked_by && updatedPatient.journey.locked_by !== techId) {
      setMessage(`Patient ${updatedPatient.name} is already being processed by ${updatedPatient.journey.locked_by}`);
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    
    const locked = await db.lockPatient(updatedPatient.local_id, techId);
    
    if (!locked) {
      // Double-check: fetch fresh data in case of race condition
      await loadPatients();
      const freshPatient = patients.find(p => p.local_id === patient.local_id);
      setMessage(`Patient ${freshPatient?.name || patient.name} is already being processed`);
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    
    // SUCCESSFULLY LOCKED - immediately update UI so other users see it
    const updatedPatients = patients.map(p => {
      if (p.local_id === patient.local_id) {
        return {
          ...p,
          journey: {
            ...p.journey,
            locked_by: techId,
            status: 'in-progress'
          }
        };
      }
      return p;
    });
    setPatients(updatedPatients);
    
    setSelectedPatient({
      ...updatedPatient,
      journey: {
        ...updatedPatient.journey,
        locked_by: techId,
        status: 'in-progress'
      }
    });
    
    // Sync immediately to notify other devices
    if (window.syncHook?.performSync) {
      await window.syncHook.performSync();
    }
  };

  const handleBack = async () => {
    if (selectedPatient) {
      await db.unlockPatient(selectedPatient.local_id);
      
      // Update UI immediately
      const updatedPatients = patients.map(p => {
        if (p.local_id === selectedPatient.local_id) {
          return {
            ...p,
            journey: {
              ...p.journey,
              locked_by: null,
              status: 'waiting'
            }
          };
        }
        return p;
      });
      setPatients(updatedPatients);
      
      if (window.syncHook?.performSync) {
        await window.syncHook.performSync();
      }
    }
    setSelectedPatient(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatient) return;

    const form = e.target;
    const localId = db.generateTempId('ENC-LAB');
    const deviceId = db.getDeviceId();
    const now = new Date().toISOString();

    const triageEncounter = selectedPatient.encounters.find(e => e.encounter_type === 'triage');

    const encounter = {
      local_id: localId,
      server_id: null,
      patient_local_id: selectedPatient.local_id,
      encounter_type: 'lab',
      parent_encounter_id: triageEncounter?.local_id || null,
      vitals_json: JSON.stringify({
        malaria_rdt: form.malaria_rdt.value,
        hb: form.hb.value,
        wbc: form.wbc.value,
        hiv_test: form.hiv_test.value,
        blood_group: form.blood_group.value
      }),
      notes: form.notes.value,
      department_code: 'LAB-01',
      facility_code: localStorage.getItem('facility_code') || 'DEMO-FAC-001',
      clinician_id: form.tech_id.value,
      created_at: now,
      updated_at: now,
      sync_status: 'pending',
      device_id: deviceId,
      version: 1
    };

    try {
      await db.encounters.add(encounter);
      await db.queueForSync('encounters', localId, 2);
      await db.completeStage(selectedPatient.local_id, 'consultation');
      
      if (window.syncHook && window.syncHook.performSync) {
        await window.syncHook.performSync();
      }
      
      setMessage(`✓ Lab results saved for ${selectedPatient.name}! Sent to doctor.`);
      
      setTimeout(() => {
        setSelectedPatient(null);
        loadPatients();
      }, 2000);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  const getStatusDisplay = (patient) => {
    const journey = patient.journey;
    const isLockedByMe = journey.locked_by === currentTechId;
    
    // Locked by ME
    if (journey.locked_by && isLockedByMe) {
      return {
        text: 'Continue 🔒',
        class: 'bg-blue-100 text-blue-800',
        disabled: false,
        borderColor: 'border-blue-500'
      };
    }
    
    // Locked by SOMEONE ELSE (any other user, regardless of department)
    if (journey.locked_by && !isLockedByMe) {
      return {
        text: `Processing by ${journey.locked_by}`,
        class: 'bg-orange-100 text-orange-800',
        disabled: true,
        borderColor: 'border-gray-300'
      };
    }
    
    // Waiting
    return {
      text: 'Run Tests',
      class: 'bg-indigo-100 text-indigo-800',
      disabled: false,
      borderColor: 'border-indigo-500'
    };
  };

  const parseVitals = (json) => {
    try { return JSON.parse(json || '{}'); } catch { return {}; }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Laboratory - Test Results</h2>
      
      {message && (
        <div className={`mb-4 p-3 rounded text-sm ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}

      {!selectedPatient ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">Patients sent from triage for lab tests:</p>
          <div className="space-y-2">
            {patients.length === 0 && (
              <p className="text-gray-500 text-center py-8">No patients waiting for lab tests.</p>
            )}
            {patients.map(p => {
              const triage = p.encounters.find(e => e.encounter_type === 'triage');
              const vitals = parseVitals(triage?.vitals_json);
              const status = getStatusDisplay(p);
              
              return (
                <button
                  key={p.local_id}
                  onClick={() => !status.disabled && handleSelectPatient(p)}
                  disabled={status.disabled}
                  className={`w-full p-4 bg-white rounded shadow border-l-4 text-left transition-all ${
                    status.disabled 
                      ? `${status.borderColor} opacity-60 cursor-not-allowed` 
                      : `${status.borderColor} hover:bg-indigo-50 cursor-pointer`
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-lg">{p.name}</div>
                      <div className="text-sm text-gray-600">
                        From triage: {triage?.chief_complaint}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Vitals: BP {vitals.bp || '-'} | Temp {vitals.temp || '-'}°C
                      </div>
                      {p.journey?.locked_by && p.journey.locked_by !== currentTechId && (
                        <div className="text-xs text-orange-600 mt-1 font-medium">
                          🔒 Being processed by: {p.journey.locked_by}
                        </div>
                      )}
                      {p.journey?.locked_by && p.journey.locked_by === currentTechId && (
                        <div className="text-xs text-blue-600 mt-1 font-medium">
                          🔒 You are processing this patient
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
      ) : (
        <div>
          <div className="mb-4 p-3 bg-indigo-50 rounded flex justify-between items-center">
            <div>
              <div className="font-bold">{selectedPatient.name}</div>
              <div className="text-sm text-gray-600">{selectedPatient.phone} | {selectedPatient.gender}</div>
              {(() => {
                const triage = selectedPatient.encounters.find(e => e.encounter_type === 'triage');
                return (
                  <div className="text-xs text-gray-500 mt-1">
                    Triage complaint: {triage?.chief_complaint}
                  </div>
                );
              })()}
            </div>
            <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs">
              🔒 Locked by you
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Malaria RDT</label>
                <select name="malaria_rdt" className="w-full mt-1 p-2 border rounded">
                  <option value="not_done">Not Done</option>
                  <option value="negative">Negative</option>
                  <option value="positive">Positive</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Hb (g/dL)</label>
                <input name="hb" type="number" step="0.1" placeholder="12.5"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">WBC (×10⁹/L)</label>
                <input name="wbc" type="number" step="0.1" placeholder="7.5"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Blood Group</label>
                <select name="blood_group" className="w-full mt-1 p-2 border rounded">
                  <option value="">Unknown</option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">HIV Test</label>
              <select name="hiv_test" className="w-full mt-1 p-2 border rounded">
                <option value="not_done">Not Done</option>
                <option value="negative">Negative</option>
                <option value="positive">Positive</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Additional Notes</label>
              <textarea name="notes" rows="2"
                className="w-full mt-1 p-2 border rounded"
                placeholder="Any additional findings..."></textarea>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Lab Tech ID *</label>
              <input name="tech_id" required
                className="w-full mt-1 p-2 border rounded"
                placeholder="LAB-001" />
            </div>

            <div className="flex gap-3">
              <button 
                type="button"
                onClick={handleBack}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Back (Unlock Patient)
              </button>
              <button 
                type="submit"
                className="flex-1 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-medium"
              >
                Save Results & Send to Doctor
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}