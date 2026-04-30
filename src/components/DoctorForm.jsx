 import { useState, useEffect } from 'react';
import { db } from '../db/schema';

export default function DoctorForm() {
  const [triageList, setTriageList] = useState([]);
  const [selectedEncounter, setSelectedEncounter] = useState(null);
  const [patientData, setPatientData] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadTriageList();
  }, []);

  const loadTriageList = async () => {
    const needingConsultation = await db.getPatientsForDoctor();
    setTriageList(needingConsultation);
  };

  const handleSelect = async (encounter) => {
    setSelectedEncounter(encounter);
    const journey = await db.getPatientJourney(encounter.patient_local_id);
    setPatientData(journey);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedEncounter) return;

    const form = e.target;
    const localId = db.generateTempId('ENC-CON');
    const deviceId = db.getDeviceId();
    const now = new Date().toISOString();

    const encounter = {
      local_id: localId,
      server_id: null,
      patient_local_id: selectedEncounter.patient_local_id,
      encounter_type: 'consultation',
      parent_encounter_id: selectedEncounter.local_id,
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
      await db.queueForSync('encounters', localId, 2);
      
      setSaved(true);
      setSelectedEncounter(null);
      setPatientData(null);
      setTimeout(() => {
        setSaved(false);
        loadTriageList();
      }, 1500);
    } catch (err) {
      alert('Error saving consultation: ' + err.message);
    }
  };

  const parseVitals = (json) => {
    try { return JSON.parse(json || '{}'); } catch { return {}; }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Doctor Consultation</h2>
      
      {saved && (
        <div className="mb-4 p-3 bg-green-100 text-green-800 rounded text-sm">
          ✓ Consultation saved. Patient can proceed to pharmacy.
        </div>
      )}

      {!selectedEncounter ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">Patients ready for consultation (triaged today):</p>
          <div className="space-y-2">
            {triageList.length === 0 && (
              <p className="text-gray-500 text-center py-8">No patients waiting for doctor.</p>
            )}
            {triageList.map(enc => (
              <button
                key={enc.local_id}
                onClick={() => handleSelect(enc)}
                className="w-full p-3 bg-white rounded shadow border-l-4 border-yellow-500 text-left hover:bg-yellow-50"
              >
                <div className="flex justify-between">
                  <span className="font-semibold">Patient ID: {enc.patient_local_id}</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    enc.priority === 'red' ? 'bg-red-100 text-red-800' :
                    enc.priority === 'yellow' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {enc.priority?.toUpperCase() || 'GREEN'}
                  </span>
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  Complaint: {enc.chief_complaint}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Triage time: {new Date(enc.created_at).toLocaleTimeString('en-KE')}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {/* Patient Summary Card */}
          {patientData && (
            <div className="mb-4 p-4 bg-blue-50 rounded-lg">
              <h3 className="font-bold text-gray-800">{patientData.patient?.name}</h3>
              <p className="text-sm text-gray-600">
                {patientData.patient?.phone} | {patientData.patient?.gender} | {patientData.patient?.county}
              </p>
              
              {patientData.encounters?.filter(e => e.encounter_type === 'triage').map(triage => (
                <div key={triage.local_id} className="mt-2 p-2 bg-white rounded text-sm">
                  <strong>Triage Vitals:</strong><br/>
                  {(() => {
                    const v = parseVitals(triage.vitals_json);
                    return `BP: ${v.bp || '-'} | Temp: ${v.temp || '-'}°C | Weight: ${v.weight || '-'}kg | SpO2: ${v.spo2 || '-'}%`;
                  })()}<br/>
                  <strong>Complaint:</strong> {triage.chief_complaint}
                </div>
              ))}
            </div>
          )}

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
                onClick={() => { setSelectedEncounter(null); setPatientData(null); }}
                className="flex-1 py-2 px-4 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Back to List
              </button>
              <button 
                type="submit"
                className="flex-1 py-2 px-4 bg-green-600 text-white rounded hover:bg-green-700 font-medium"
              >
                Save Consultation
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
