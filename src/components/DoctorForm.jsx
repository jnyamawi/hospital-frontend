import { useState, useEffect } from 'react';
import { db } from '../db/schema';

export default function DoctorForm() {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    // Get patients sent to doctor (from triage OR from lab)
    const doctorPatients = await db.getPatientsForStage('consultation');
    setPatients(doctorPatients);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedPatient) return;

    const form = e.target;
    const localId = db.generateTempId('ENC-CON');
    const deviceId = db.getDeviceId();
    const now = new Date().toISOString();

    // Find parent encounter (lab if exists, otherwise triage)
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
      prescriptions_json: JSON.stringify([{
        drug: form.drug.value,
        qty: parseInt(form.qty.value),
        dosage: form.dosage.value
      }]),
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
      
      // Update journey: doctor completed → next is pharmacy
      await db.completeStage(selectedPatient.local_id, 'pharmacy');
      
      await db.queueForSync('encounters', localId, 2);
      
      setSaved(true);
      setMessage(`✓ Diagnosis saved for ${selectedPatient.name}! Sent to pharmacy.`);
      
      setTimeout(() => {
        setSaved(false);
        setSelectedPatient(null);
        loadPatients();
      }, 2000);
    } catch (err) {
      setMessage('Error: ' + err.message);
    }
  };

  const parseVitals = (json) => {
    try { return JSON.parse(json || '{}'); } catch { return {}; }
  };

  const parsePrescriptions = (json) => {
    try { return JSON.parse(json || '[]'); } catch { return []; }
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
              
              return (
                <button
                  key={p.local_id}
                  onClick={() => setSelectedPatient(p)}
                  className="w-full p-4 bg-white rounded shadow border-l-4 border-green-500 text-left hover:bg-green-50"
                >
                  <div className="flex justify-between">
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
                    </div>
                    <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium self-center">
                      {lab ? 'From Lab' : 'From Triage'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          {/* Patient Summary */}
          <div className="mb-4 p-4 bg-green-50 rounded-lg">
            <h3 className="font-bold text-gray-800">{selectedPatient.name}</h3>
            <p className="text-sm text-gray-600">
              {selectedPatient.phone} | {selectedPatient.gender} | {selectedPatient.county}
            </p>
            
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
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
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

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Drug *</label>
                <input name="drug" required
                  className="w-full mt-1 p-2 border rounded" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Qty *</label>
                <input name="qty" required type="number"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Dosage *</label>
                <input name="dosage" required placeholder="500mg TDS"
                  className="w-full mt-1 p-2 border rounded" />
              </div>
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
                onClick={() => setSelectedPatient(null)}
                className="flex-1 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Back to List
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