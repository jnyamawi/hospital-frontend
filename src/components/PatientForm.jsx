import { useState, useEffect } from 'react';
import { db } from '../db/schema';

export default function PatientForm({ onSuccess }) {
  const [mode, setMode] = useState('search'); // 'search' | 'new' | 'found' | 'confirm'
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');

  // Search local database for patients
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    const query = searchQuery.toUpperCase().trim();
    
    // Search by local_id or national_id or phone or name
    const allPatients = await db.patients.toArray();
    const results = allPatients.filter(p => 
      p.local_id.includes(query) ||
      (p.national_id && p.national_id.includes(query)) ||
      p.phone.includes(query) ||
      p.name.includes(query)
    );

    setSearchResults(results);
    
    if (results.length === 0) {
      setMessage('No patient found. Register as new patient.');
      setMode('new');
    } else {
      setMode('found');
    }
  };

  // Check if patient already has an encounter today
  const checkTodayVisit = async (patientLocalId) => {
    const today = new Date().toISOString().split('T')[0];
    const encounters = await db.encounters
      .where('patient_local_id')
      .equals(patientLocalId)
      .toArray();
    
    return encounters.some(e => e.created_at.startsWith(today));
  };

  // Select returning patient
  const selectReturningPatient = async (patient) => {
    const hasVisitToday = await checkTodayVisit(patient.local_id);
    
    if (hasVisitToday) {
      setMessage(`⚠️ ${patient.name} already has a visit recorded today.`);
      return;
    }

    setSelectedPatient(patient);
    setMode('confirm');
  };

  // Quick re-register (create new encounter for returning patient)
  const handleQuickRegister = async () => {
    setSaving(true);
    const now = new Date().toISOString();

    // Create a registration encounter for tracking
    const encounter = {
      local_id: db.generateTempId('ENC-REG'),
      server_id: null,
      patient_local_id: selectedPatient.local_id,
      encounter_type: 'registration',
      parent_encounter_id: null,
      vitals_json: null,
      chief_complaint: 'Returning patient - follow up',
      department_code: 'REC-01',
      facility_code: localStorage.getItem('facility_code') || 'DEMO-FAC-001',
      clinician_id: localStorage.getItem('staff_id') || 'REC-001',
      created_at: now,
      updated_at: now,
      sync_status: 'pending',
      device_id: db.getDeviceId(),
      version: 1
    };

    try {
      await db.encounters.add(encounter);
      await db.queueForSync('encounters', encounter.local_id, 2);
      
      // Update patient's updated_at
      await db.patients.update(selectedPatient.local_id, {
        updated_at: now,
        sync_status: 'pending'
      });
      await db.queueForSync('patients', selectedPatient.local_id, 1);

      // CREATE PATIENT JOURNEY — send to triage
      await db.updatePatientJourney(selectedPatient.local_id, 'registration', 'triage', 'waiting');

      setSaved(true);
      setMessage(`✓ ${selectedPatient.name} checked in successfully! Send to triage.`);
      
      setTimeout(() => {
        setSaved(false);
        setSelectedPatient(null);
        setSearchQuery('');
        setSearchResults([]);
        setMode('search');
      }, 2000);
    } catch (err) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // New patient registration
  const handleNewRegister = async (e) => {
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
      await db.queueForSync('patients', localId, 1);
      
      // CREATE PATIENT JOURNEY — send to triage
      await db.updatePatientJourney(localId, 'registration', 'triage', 'waiting');
      
      setSaved(true);
      setMessage(`✓ New patient ${patient.name} registered!`);
      
      setTimeout(() => {
        setSaved(false);
        form.reset();
        setMode('search');
      }, 1500);
    } catch (err) {
      setMessage('Error saving: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Patient Reception</h2>
      
      {message && (
        <div className={`mb-4 p-3 rounded text-sm ${message.includes('Error') || message.includes('⚠️') ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
          {message}
        </div>
      )}

      {/* SEARCH MODE */}
      {mode === 'search' && (
        <div className="bg-white rounded shadow p-6">
          <p className="text-gray-600 mb-4">Search for returning patient by ID, National ID, Phone, or Name:</p>
          
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
              placeholder="Enter PT-XXXX, National ID, Phone, or Name"
              className="flex-1 p-3 border rounded-lg"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Search
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              onClick={() => { setMode('new'); setMessage(''); }}
              className="text-blue-600 hover:underline text-sm"
            >
              + Register New Patient Instead
            </button>
          </div>
        </div>
      )}

      {/* SEARCH RESULTS */}
      {mode === 'found' && (
        <div className="bg-white rounded shadow p-6">
          <h3 className="font-semibold mb-3">Select Patient:</h3>
          <div className="space-y-2">
            {searchResults.map(p => (
              <button
                key={p.local_id}
                onClick={() => selectReturningPatient(p)}
                className="w-full p-4 bg-gray-50 rounded-lg text-left hover:bg-blue-50 border-2 border-transparent hover:border-blue-300 transition"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-lg">{p.name}</div>
                    <div className="text-sm text-gray-600">
                      ID: {p.local_id} {p.national_id && `| National: ${p.national_id}`}
                    </div>
                    <div className="text-sm text-gray-600">
                      {p.gender} | {p.phone} | {p.county}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Last visit: {new Date(p.updated_at).toLocaleDateString('en-KE')}
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                    Select
                  </span>
                </div>
              </button>
            ))}
          </div>
          
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => { setMode('search'); setSearchResults([]); }}
              className="flex-1 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              Search Again
            </button>
            <button
              onClick={() => { setMode('new'); setMessage(''); }}
              className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              New Patient
            </button>
          </div>
        </div>
      )}

      {/* CONFIRM RETURNING PATIENT */}
      {mode === 'confirm' && selectedPatient && (
        <div className="bg-white rounded shadow p-6">
          <h3 className="font-semibold mb-4">Confirm Returning Patient</h3>
          
          <div className="bg-blue-50 rounded-lg p-4 mb-4">
            <div className="font-bold text-xl">{selectedPatient.name}</div>
            <div className="text-sm text-gray-600 mt-1">
              Patient ID: {selectedPatient.local_id}
            </div>
            <div className="text-sm text-gray-600">
              {selectedPatient.gender} | DOB: {selectedPatient.dob || 'N/A'} | {selectedPatient.phone}
            </div>
            <div className="text-sm text-gray-600">
              {selectedPatient.county}, {selectedPatient.sub_county}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { setSelectedPatient(null); setMode('found'); }}
              className="flex-1 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Back
            </button>
            <button
              onClick={handleQuickRegister}
              disabled={saving}
              className="flex-1 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Checking in...' : '✓ Check In & Send to Triage'}
            </button>
          </div>
        </div>
      )}

      {/* NEW PATIENT REGISTRATION */}
      {mode === 'new' && (
        <div className="bg-white rounded shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">New Patient Registration</h3>
            <button
              onClick={() => { setMode('search'); setMessage(''); }}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Back to Search
            </button>
          </div>

          <form onSubmit={handleNewRegister} className="space-y-3">
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
              {saving ? 'Saving...' : 'Save Patient & Send to Triage'}
            </button>
          </form>
        </div>
      )}

      {saved && (
        <div className="mt-4 p-3 bg-green-100 text-green-800 rounded text-sm text-center">
          ✓ Patient checked in successfully!
        </div>
      )}
    </div>
  );
}