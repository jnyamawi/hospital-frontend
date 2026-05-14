import { useState, useEffect } from 'react';
import { db } from '../db/schema';

export default function DoctorForm() {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [drugs, setDrugs] = useState([{ drug: '', qty: '', dosage: '' }]);
  const [currentDoctorId, setCurrentDoctorId] = useState('');

  useEffect(() => {
    const doctorId = localStorage.getItem('user_staff_id') || 'UNKNOWN';
    setCurrentDoctorId(doctorId);
  }, []);

  useEffect(() => {
    loadPatients();
    const interval = setInterval(() => {
      loadPatients();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadPatients = async () => {
    const doctorPatients = await db.getPatientsForStage('consultation');
    setPatients(doctorPatients);
  };

  const handleSelectPatient = async (patient) => {
    const doctorId = currentDoctorId || localStorage.getItem('user_staff_id') || 'UNKNOWN';
    
    // If already locked by me, just open it (no need to re-lock)
    if (patient.journey?.locked_by === doctorId) {
      setSelectedPatient(patient);
      return;
    }
    
    // Try to lock the patient
    const locked = await db.lockPatient(patient.local_id, doctorId);
    
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
    setDrugs([{ drug: '', qty: '', dosage: '' }]);
  };

  const handleAddDrug = () => {
    setDrugs([...drugs, { drug: '', qty: '', dosage: '' }]);
  };

  const handleRemoveDrug = (index) => {
    if (drugs.length === 1) return;
    const newDrugs = drugs.filter((_, i) => i !== index);
    setDrugs(newDrugs);
  };

  const handleDrugChange = (index, field, value) => {
    const newDrugs = [...drugs];
    newDrugs[index][field] = value;
    setDrugs(newDrugs);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatient) return;

    const form = e.target;
    const localId = db.generateTempId('ENC-CON');
    const deviceId = db.getDeviceId();
    const now = new Date().toISOString();

    const validDrugs = drugs.filter(d => d.drug.trim() !== '');
    
    if (validDrugs.length === 0) {
      setMessage('Error: Please add at least one drug');
      return;
    }

    const labEncounter = selectedPatient.encounters.find(e => e.encounter_type === 'lab');
    const triageEncounter = selectedPatient.encounters.find(e => e.encounter_type === 'triage');
    const parentId = labEncounter?.local_id || triageEncounter?.local_id || null;

    const encounter = {
      local_id: localId,
      server_id: null,
      patient_local_id: selectedPatient.local_id,
      encounter_type: 'consultation',
      parent_encounter_id: parentId,
      diagnosis_codes: form.diagnosis.value,
      notes: form.notes.value,
      prescriptions_json: JSON.stringify(validDrugs),
      department_code: 'DOC-01',
      facility_code: localStorage.getItem('facility_code') || 'DEMO-FAC-001',
      clinician_id: form.doctor_id.value,
      created_at: now,
      updated_at: now,
      sync_status: 'pending',
      device_id: deviceId,
      version: 1
    };

    try {
      await db.encounters.add(encounter);
      await db.completeStage(selectedPatient.local_id, 'pharmacy');
      await db.queueForSync('encounters', localId, 2);
      
      if (window.syncHook?.performSync) {
        await window.syncHook.performSync();
      }
      
      setSaved(true);
      setMessage(`✓ Diagnosis saved for ${selectedPatient.name}! Sent to pharmacy.`);
      
      setTimeout(() => {
        setSaved(false);
        setSelectedPatient(null);
        setDrugs([{ drug: '', qty: '', dosage: '' }]);
        loadPatients();
      }, 2000);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  const getStatusDisplay = (patient) => {
    const journey = patient.journey;
    const isLockedByMe = journey.locked_by === currentDoctorId;
    
    // Patient is locked by ME
    if (journey.locked_by && isLockedByMe) {
      return {
        text: 'Continue 🔒',
        class: 'bg-blue-100 text-blue-800',
        disabled: false,
        borderColor: 'border-blue-500'
      };
    }
    
    // Patient is locked by SOMEONE ELSE (any other user)
    if (journey.locked_by && !isLockedByMe) {
      return {
        text: `Being seen by ${journey.locked_by}`,
        class: 'bg-orange-100 text-orange-800',
        disabled: true,
        borderColor: 'border-gray-300'
      };
    }
    
    if (journey.status === 'waiting') {
      return {
        text: 'From Lab/Triage',
        class: 'bg-green-100 text-green-800',
        disabled: false,
        borderColor: 'border-green-500'
      };
    }
    
    return {
      text: journey.status,
      class: 'bg-gray-100 text-gray-800',
      disabled: true,
      borderColor: 'border-gray-300'
    };
  };

  const parseVitals = (json) => {
    try { return JSON.parse(json || '{}'); } catch { return {}; }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Doctor Consultation</h2>
      
      {message && (
        <div className={`mb-4 p-3 rounded text-sm ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}

      {!selectedPatient ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">Patients ready for consultation:</p>
          <div className="space-y-2">
            {patients.length === 0 && (
              <p className="text-gray-500 text-center py-8">No patients waiting for doctor.</p>
            )}
            {patients.map(p => {
              const triage = p.encounters.find(e => e.encounter_type === 'triage');
              const lab = p.encounters.find(e => e.encounter_type === 'lab');
              const vitals = parseVitals(triage?.vitals_json);
              const labResults = parseVitals(lab?.vitals_json);
              const status = getStatusDisplay(p);
              
              return (
                <button
                  key={p.local_id}
                  onClick={() => !status.disabled && handleSelectPatient(p)}
                  disabled={status.disabled}
                  className={`w-full p-4 bg-white rounded shadow border-l-4 text-left transition-all ${
                    status.disabled 
                      ? `${status.borderColor} opacity-60 cursor-not-allowed` 
                      : `${status.borderColor} hover:bg-green-50 cursor-pointer`
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-lg">{p.name}</div>
                      <div className="text-sm text-gray-600">
                        {triage?.chief_complaint}
                      </div>
                      <div className="flex gap-2 mt-1">
                        <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">
                          BP: {vitals.bp || '-'} | Temp: {vitals.temp || '-'}
                        </span>
                        {lab && (
                          <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs">
                            Lab: Malaria {labResults.malaria_rdt || '-'} | Hb {labResults.hb || '-'}
                          </span>
                        )}
                      </div>
                      {p.journey?.locked_by && p.journey.locked_by !== currentDoctorId && (
                        <div className="text-xs text-orange-600 mt-1 font-medium">
                          🔒 Being seen by: {p.journey.locked_by}
                        </div>
                      )}
                      {p.journey?.locked_by && p.journey.locked_by === currentDoctorId && (
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
      ) : (
        <div>
          <div className="mb-4 p-4 bg-green-50 rounded-lg flex justify-between items-start">
            <div>
              <h3 className="font-bold text-gray-800">{selectedPatient.name}</h3>
              <p className="text-sm text-gray-600">
                {selectedPatient.phone} | {selectedPatient.gender} | {selectedPatient.county}
              </p>
            </div>
            <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs">
              🔒 Locked by you
            </span>
          </div>
          
          {(() => {
            const triage = selectedPatient.encounters.find(e => e.encounter_type === 'triage');
            const vitals = parseVitals(triage?.vitals_json);
            return (
              <div className="mt-2 p-2 bg-white rounded text-sm">
                <strong>Triage Vitals:</strong> BP {vitals.bp || '-'} | Temp {vitals.temp || '-'}°C | 
                Weight {vitals.weight || '-'}kg | SpO2 {vitals.spo2 || '-'}%<br/>
                <strong>Complaint:</strong> {triage?.chief_complaint}
              </div>
            );
          })()}

          {(() => {
            const lab = selectedPatient.encounters.find(e => e.encounter_type === 'lab');
            if (!lab) return null;
            const results = parseVitals(lab.vitals_json);
            return (
              <div className="mt-2 p-2 bg-indigo-50 rounded text-sm">
                <strong>Lab Results:</strong><br/>
                Malaria RDT: {results.malaria_rdt || '-'} | Hb: {results.hb || '-'} g/dL | 
                WBC: {results.wbc || '-'} | Blood Group: {results.blood_group || '-'}<br/>
                <strong>Notes:</strong> {lab.notes || 'None'}
              </div>
            );
          })()}

          <form onSubmit={handleSubmit} className="space-y-3 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">ICD-10 Diagnosis Codes *</label>
              <input name="diagnosis" required placeholder="R50.9, J06.9"
                className="w-full mt-1 p-2 border rounded" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Clinical Notes</label>
              <textarea name="notes" rows="3"
                className="w-full mt-1 p-2 border rounded"
                placeholder="Examination findings, plan..."></textarea>
            </div>

            <div className="border rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-gray-700">Prescriptions *</label>
                <button
                  type="button"
                  onClick={handleAddDrug}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  + Add Drug
                </button>
              </div>
              
              {drugs.map((drug, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 mb-2 items-end">
                  <div className="col-span-4">
                    <input
                      type="text"
                      value={drug.drug}
                      onChange={(e) => handleDrugChange(index, 'drug', e.target.value)}
                      placeholder="Drug name"
                      className="w-full p-2 border rounded text-sm"
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={drug.qty}
                      onChange={(e) => handleDrugChange(index, 'qty', e.target.value)}
                      placeholder="Qty"
                      className="w-full p-2 border rounded text-sm"
                      required
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      type="text"
                      value={drug.dosage}
                      onChange={(e) => handleDrugChange(index, 'dosage', e.target.value)}
                      placeholder="e.g., 500mg TDS"
                      className="w-full p-2 border rounded text-sm"
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    {drugs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveDrug(index)}
                        className="w-full py-2 bg-red-100 text-red-600 rounded text-sm hover:bg-red-200"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Doctor ID *</label>
              <input name="doctor_id" required
                className="w-full mt-1 p-2 border rounded"
                placeholder="DOC-001" />
            </div>

            <div className="flex gap-3">
              <button 
                type="button"
                onClick={handleBack}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Back to List (Unlock)
              </button>
              <button 
                type="submit"
                className="flex-1 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-medium"
              >
                Save & Send to Pharmacy
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}