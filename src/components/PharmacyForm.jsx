import { useState, useEffect } from 'react';
import { db } from '../db/schema';

export default function PharmacyForm() {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [currentPharmacistId, setCurrentPharmacistId] = useState('');

  useEffect(() => {
    const pharmacistId = localStorage.getItem('user_staff_id') || 'UNKNOWN';
    setCurrentPharmacistId(pharmacistId);
  }, []);

  useEffect(() => {
    loadPatients();
    const interval = setInterval(() => {
      loadPatients();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadPatients = async () => {
    const pharmacyPatients = await db.getPatientsForStage('pharmacy');
    setPatients(pharmacyPatients);
  };

  const handleSelectPatient = async (patient) => {
    const pharmacistId = currentPharmacistId || localStorage.getItem('user_staff_id') || 'UNKNOWN';
    
    // If already locked by me, just open it (no need to re-lock)
    if (patient.journey?.locked_by === pharmacistId) {
      setSelectedPatient(patient);
      return;
    }
    
    const locked = await db.lockPatient(patient.local_id, pharmacistId);
    
    if (!locked) {
      await loadPatients();
      setMessage(`Patient ${patient.name} is already being dispensed by ${patient.journey.locked_by}`);
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
  };

  const handleDispense = async (e) => {
    e.preventDefault();
    if (!selectedPatient) return;

    const form = e.target;
    const localId = db.generateTempId('ENC-PHA');
    const deviceId = db.getDeviceId();
    const now = new Date().toISOString();

    const consultation = selectedPatient.encounters.find(e => e.encounter_type === 'consultation');
    const prescriptions = parsePrescriptions(consultation?.prescriptions_json);

    const encounter = {
      local_id: localId,
      server_id: null,
      patient_local_id: selectedPatient.local_id,
      encounter_type: 'pharmacy',
      parent_encounter_id: consultation?.local_id || null,
      notes: `Dispensed: ${prescriptions.map(p => `${p.drug} x${p.qty}`).join(', ')}. ${form.notes.value}`,
      department_code: 'PHA-01',
      facility_code: localStorage.getItem('facility_code') || 'DEMO-FAC-001',
      clinician_id: form.pharmacist_id.value,
      created_at: now,
      updated_at: now,
      sync_status: 'pending',
      device_id: deviceId,
      version: 1
    };

    try {
      await db.encounters.add(encounter);
      await db.completeStage(selectedPatient.local_id, 'completed');
      await db.queueForSync('encounters', localId, 2);
      
      if (window.syncHook?.performSync) {
        await window.syncHook.performSync();
      }
      
      setSaved(true);
      setMessage(`✓ Medication dispensed to ${selectedPatient.name}! Patient journey complete.`);
      
      setTimeout(() => {
        setSaved(false);
        setSelectedPatient(null);
        loadPatients();
      }, 2000);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  const getStatusDisplay = (patient) => {
    const journey = patient.journey;
    const isLockedByMe = journey.locked_by === currentPharmacistId;
    
    // Locked by SOMEONE ELSE
    if (journey.status === 'in-progress' && journey.locked_by && !isLockedByMe) {
      return {
        text: `Dispensing by ${journey.locked_by}`,
        class: 'bg-orange-100 text-orange-800',
        disabled: true,
        borderColor: 'border-gray-300'
      };
    }
    
    // Locked by ME
    if (journey.status === 'in-progress' && journey.locked_by && isLockedByMe) {
      return {
        text: 'Continue 🔒',
        class: 'bg-blue-100 text-blue-800',
        disabled: false,
        borderColor: 'border-blue-500'
      };
    }
    
    if (journey.status === 'waiting') {
      return {
        text: 'Dispense',
        class: 'bg-pink-100 text-pink-800',
        disabled: false,
        borderColor: 'border-pink-500'
      };
    }
    
    return {
      text: journey.status,
      class: 'bg-gray-100 text-gray-800',
      disabled: true,
      borderColor: 'border-gray-300'
    };
  };

  const parsePrescriptions = (json) => {
    try { return JSON.parse(json || '[]'); } catch { return []; }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Pharmacy - Dispense Medication</h2>
      
      {message && (
        <div className={`mb-4 p-3 rounded text-sm ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}

      {!selectedPatient ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">Patients with prescriptions from doctor:</p>
          <div className="space-y-2">
            {patients.length === 0 && (
              <p className="text-gray-500 text-center py-8">No prescriptions waiting.</p>
            )}
            {patients.map(p => {
              const consultation = p.encounters.find(e => e.encounter_type === 'consultation');
              const prescriptions = parsePrescriptions(consultation?.prescriptions_json);
              const status = getStatusDisplay(p);
              
              return (
                <button
                  key={p.local_id}
                  onClick={() => !status.disabled && handleSelectPatient(p)}
                  disabled={status.disabled}
                  className={`w-full p-4 bg-white rounded shadow border-l-4 text-left transition-all ${
                    status.disabled 
                      ? `${status.borderColor} opacity-60 cursor-not-allowed` 
                      : `${status.borderColor} hover:bg-pink-50 cursor-pointer`
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-lg">{p.name}</div>
                      <div className="text-sm text-gray-600">
                        Diagnosis: {consultation?.diagnosis_codes || '-'}
                      </div>
                      <div className="text-sm text-indigo-700 mt-1">
                        {prescriptions.map((rx, i) => (
                          <span key={i} className="mr-2 px-2 py-1 bg-indigo-100 rounded text-xs">
                            {rx.drug} x{rx.qty} ({rx.dosage})
                          </span>
                        ))}
                      </div>
                      {p.journey?.locked_by && p.journey.locked_by !== currentPharmacistId && (
                        <div className="text-xs text-orange-600 mt-1 font-medium">
                          🔒 Being dispensed by: {p.journey.locked_by}
                        </div>
                      )}
                      {p.journey?.locked_by && p.journey.locked_by === currentPharmacistId && (
                        <div className="text-xs text-blue-600 mt-1 font-medium">
                          🔒 You are dispensing this patient
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
          <div className="mb-4 p-4 bg-pink-50 rounded-lg flex justify-between items-start">
            <div>
              <h3 className="font-bold text-gray-800">{selectedPatient.name}</h3>
              <p className="text-sm text-gray-600">{selectedPatient.phone}</p>
            </div>
            <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs">
              🔒 Locked by you
            </span>
          </div>
          
          {(() => {
            const consultation = selectedPatient.encounters.find(e => e.encounter_type === 'consultation');
            const prescriptions = parsePrescriptions(consultation?.prescriptions_json);
            
            return (
              <div className="mt-3 space-y-2">
                <div className="p-2 bg-white rounded text-sm">
                  <strong>Diagnosis:</strong> {consultation?.diagnosis_codes}<br/>
                  <strong>Doctor Notes:</strong> {consultation?.notes || 'None'}
                </div>
                
                <div className="p-2 bg-indigo-50 rounded">
                  <strong className="text-sm">Prescription:</strong>
                  {prescriptions.map((rx, i) => (
                    <div key={i} className="text-sm mt-1">
                      {i + 1}. {rx.drug} — Quantity: {rx.qty} — {rx.dosage}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <form onSubmit={handleDispense} className="space-y-3 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Dispensing Notes</label>
              <textarea name="notes" rows="2"
                className="w-full mt-1 p-2 border rounded"
                placeholder="Batch numbers, patient counseling notes..."></textarea>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Pharmacist ID *</label>
              <input name="pharmacist_id" required
                className="w-full mt-1 p-2 border rounded"
                placeholder="PHA-001" />
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
                className="flex-1 py-2 bg-pink-600 text-white rounded hover:bg-pink-700 font-medium"
              >
                Confirm Dispense & Complete
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}