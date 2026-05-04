import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { db } from '../db/schema';

import { API_BASE } from '../config';

const ROLES = [
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'triage_nurse', label: 'Triage Nurse' },
  { value: 'doctor', label: 'Doctor' },
  { value: 'lab_technician', label: 'Lab Technician' },
  { value: 'pharmacist', label: 'Pharmacist' },
  { value: 'admin', label: 'Administrator' },
];

// Hour presets for quick selection
const HOUR_PRESETS = [
  { label: 'All Day', from: 0, to: 23 },
  { label: 'Morning (6AM-12PM)', from: 6, to: 12 },
  { label: 'Afternoon (12PM-6PM)', from: 12, to: 18 },
  { label: 'Evening (6PM-12AM)', from: 18, to: 23 },
  { label: 'Night (12AM-6AM)', from: 0, to: 6 },
];

// Department stages
const DEPARTMENTS = [
  { value: '', label: 'All Departments' },
  { value: 'registration', label: 'Reception' },
  { value: 'triage', label: 'Triage' },
  { value: 'lab', label: 'Laboratory' },
  { value: 'consultation', label: 'Doctor' },
  { value: 'pharmacy', label: 'Pharmacy' },
];

export default function AdminDashboard() {
  const { token, isOnline } = useAuth();
  
  // User management states
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [formData, setFormData] = useState({
    staff_id: '',
    name: '',
    email: '',
    phone: '',
    role: 'receptionist',
    department_code: '',
    password: ''
  });

  // Reports/Records states
  const [activeView, setActiveView] = useState('users');
  const [fromDate, setFromDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [fromHour, setFromHour] = useState(0);
  const [toHour, setToHour] = useState(23);
  const [hourPreset, setHourPreset] = useState('All Day');
  const [department, setDepartment] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [patients, setPatients] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [reportView, setReportView] = useState('summary');

  // Load users on mount
  useEffect(() => {
    loadUsers();
  }, []);

  // Load records when filters change
  useEffect(() => {
    if (activeView === 'records' || activeView === 'reports') {
      loadRecords();
    }
  }, [activeView, fromDate, toDate, department]);

  const loadUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setMessage('User created successfully!');
        setShowForm(false);
        setFormData({
          staff_id: '', name: '', email: '', phone: '',
          role: 'receptionist', department_code: '', password: ''
        });
        loadUsers();
      } else {
        const error = await response.json();
        setMessage(`Error: ${error.detail}`);
      }
    } catch (err) {
      setMessage('Failed to create user');
    }
  };

  const handleDelete = async (userId) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
      await fetch(`${API_BASE}/auth/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const handleHourPresetChange = (presetLabel) => {
    const preset = HOUR_PRESETS.find(p => p.label === presetLabel);
    if (preset) {
      setHourPreset(presetLabel);
      setFromHour(preset.from);
      setToHour(preset.to);
    }
  };

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      let data = [];
      
      if (isOnline) {
        const params = new URLSearchParams();
        if (fromDate) params.append('from_date', `${fromDate}T00:00:00`);
        if (toDate) params.append('to_date', `${toDate}T23:59:59`);
        if (fromHour !== 0 || toHour !== 23) {
          params.append('from_hour', fromHour);
          params.append('to_hour', toHour);
        }
        if (department) params.append('department', department);
        if (searchQuery) params.append('search', searchQuery);
        
        try {
          const response = await fetch(`${API_BASE}/reports/patients?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (response.ok) {
            const result = await response.json();
            data = result.data || [];
            
            const statsResponse = await fetch(`${API_BASE}/reports/statistics?${params}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (statsResponse.ok) {
              setStatistics(await statsResponse.json());
            }
          }
        } catch (err) {
          console.log('Backend unavailable, using local data');
        }
      }
      
      if (data.length === 0) {
        data = await loadFromLocalDB();
      }
      
      if (searchQuery && data.length > 0) {
        const q = searchQuery.toLowerCase();
        data = data.filter(p => 
          p.name?.toLowerCase().includes(q) ||
          p.patient_id?.toLowerCase().includes(q) ||
          p.phone?.includes(q)
        );
      }
      
      setPatients(data);
    } catch (err) {
      console.error('Failed to load records:', err);
      setMessage('Error loading records. Showing local data only.');
      const local = await loadFromLocalDB();
      setPatients(local);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, fromHour, toHour, department, searchQuery, isOnline, token]);

  const loadFromLocalDB = async () => {
    const allPatients = await db.patients.toArray();
    const allJourneys = await db.patientJourney.toArray();
    const allEncounters = await db.encounters.toArray();
    
    const reports = [];
    for (const journey of allJourneys) {
      const patient = allPatients.find(p => p.local_id === journey.patient_local_id);
      if (!patient) continue;
      
      const encounters = allEncounters.filter(e => 
        e.patient_local_id === journey.patient_local_id
      ).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      
      const visitDate = new Date(journey.created_at);
      const from = new Date(fromDate);
      const to = new Date(toDate);
      to.setHours(23, 59, 59);
      
      if (visitDate < from || visitDate > to) continue;
      
      const hour = visitDate.getHours();
      if (hour < fromHour || hour > toHour) continue;
      
      if (department && journey.current_stage !== department) continue;
      
      const latestEncounter = encounters[encounters.length - 1];
      
      reports.push({
        patient_id: patient.local_id,
        name: patient.name,
        phone: patient.phone,
        gender: patient.gender,
        age: calculateAge(patient.dob),
        national_id: patient.national_id,
        visit_date: journey.created_at,
        current_stage: journey.current_stage,
        next_stage: journey.next_stage,
        status: journey.status,
        department: latestEncounter?.department_code,
        clinician: latestEncounter?.clinician_id,
        chief_complaint: encounters.find(e => e.encounter_type === 'triage')?.chief_complaint,
        vitals: encounters.find(e => e.encounter_type === 'triage')?.vitals_json,
        diagnosis: encounters.find(e => e.encounter_type === 'consultation')?.diagnosis_codes,
        prescriptions: encounters.find(e => e.encounter_type === 'consultation')?.prescriptions_json,
        lab_results: encounters.find(e => e.encounter_type === 'lab')?.vitals_json,
        pharmacy_notes: encounters.find(e => e.encounter_type === 'pharmacy')?.notes,
        encounters: encounters
      });
    }
    
    const stats = {
      total_visits: reports.length,
      by_stage: reports.reduce((acc, p) => {
        acc[p.current_stage] = (acc[p.current_stage] || 0) + 1;
        return acc;
      }, {}),
      by_status: reports.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      }, {}),
      by_gender: reports.reduce((acc, p) => {
        acc[p.gender] = (acc[p.gender] || 0) + 1;
        return acc;
      }, {})
    };
    setStatistics(stats);
    
    return reports.sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
  };

  const exportToCSV = () => {
    if (patients.length === 0) return;
    
    const headers = [
      'Patient ID', 'Name', 'Phone', 'National ID', 'Gender', 'Age', 
      'Visit Date', 'Current Stage', 'Next Stage', 'Status', 
      'Department', 'Clinician', 'Chief Complaint', 'Diagnosis', 'Lab Results', 'Pharmacy Notes'
    ];
    
    const rows = patients.map(p => [
      p.patient_id,
      p.name,
      p.phone,
      p.national_id || '',
      p.gender,
      p.age || '',
      new Date(p.visit_date).toLocaleString('en-KE'),
      p.current_stage,
      p.next_stage,
      p.status,
      p.department || '',
      p.clinician || '',
      p.chief_complaint || '',
      p.diagnosis || '',
      p.lab_results || '',
      p.pharmacy_notes || ''
    ]);
    
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `patient-report-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    window.print();
  };

  const stats = statistics || {
    total_visits: patients.length,
    by_stage: patients.reduce((acc, p) => {
      acc[p.current_stage] = (acc[p.current_stage] || 0) + 1;
      return acc;
    }, {}),
    by_status: patients.reduce((acc, p) => {
      acc[p.status] = (acc[p.status] || 0) + 1;
      return acc;
    }, {}),
    by_gender: patients.reduce((acc, p) => {
      acc[p.gender] = (acc[p.gender] || 0) + 1;
      return acc;
    }, {})
  };

  const getStageColor = (stage) => {
    const colors = {
      registration: 'bg-yellow-100 text-yellow-800',
      triage: 'bg-blue-100 text-blue-800',
      lab: 'bg-indigo-100 text-indigo-800',
      consultation: 'bg-green-100 text-green-800',
      pharmacy: 'bg-pink-100 text-pink-800',
      completed: 'bg-gray-100 text-gray-800'
    };
    return colors[stage] || 'bg-gray-100 text-gray-800';
  };

  const getStatusColor = (status) => {
    const colors = {
      waiting: 'bg-yellow-100 text-yellow-800',
      'in-progress': 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  // Helper functions for clinical reports
  const parseVitals = (json) => {
    try { return JSON.parse(json || '{}'); } catch { return {}; }
  };

  const parsePrescriptions = (json) => {
    try { return JSON.parse(json || '[]'); } catch { return []; }
  };

  const renderTriageReport = (encounter) => {
    const vitals = parseVitals(encounter?.vitals_json);
    return (
      <div className="border-t pt-4">
        <h4 className="font-semibold text-blue-800 mb-2">🩺 Triage Assessment</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div className="bg-blue-50 p-2 rounded">
            <span className="text-gray-600">Blood Pressure:</span>
            <div className="font-medium">{vitals.bp || 'N/A'}</div>
          </div>
          <div className="bg-blue-50 p-2 rounded">
            <span className="text-gray-600">Temperature:</span>
            <div className="font-medium">{vitals.temp ? `${vitals.temp}°C` : 'N/A'}</div>
          </div>
          <div className="bg-blue-50 p-2 rounded">
            <span className="text-gray-600">Weight:</span>
            <div className="font-medium">{vitals.weight ? `${vitals.weight} kg` : 'N/A'}</div>
          </div>
          <div className="bg-blue-50 p-2 rounded">
            <span className="text-gray-600">SpO2:</span>
            <div className="font-medium">{vitals.spo2 ? `${vitals.spo2}%` : 'N/A'}</div>
          </div>
          <div className="bg-blue-50 p-2 rounded">
            <span className="text-gray-600">Pulse:</span>
            <div className="font-medium">{vitals.pulse ? `${vitals.pulse} bpm` : 'N/A'}</div>
          </div>
          <div className="bg-blue-50 p-2 rounded">
            <span className="text-gray-600">Priority:</span>
            <div className={`font-medium ${
              encounter?.priority === 'red' ? 'text-red-600' :
              encounter?.priority === 'yellow' ? 'text-yellow-600' :
              'text-green-600'
            }`}>
              {encounter?.priority?.toUpperCase() || 'N/A'}
            </div>
          </div>
        </div>
        {encounter?.chief_complaint && (
          <div className="mt-3 p-3 bg-yellow-50 rounded">
            <span className="text-gray-600 text-sm">Chief Complaint:</span>
            <div className="font-medium">{encounter.chief_complaint}</div>
          </div>
        )}
        <div className="mt-2 text-xs text-gray-500">
          Nurse: {encounter?.clinician_id} | {new Date(encounter?.created_at).toLocaleString('en-KE')}
        </div>
      </div>
    );
  };

  const renderLabReport = (encounter) => {
    const vitals = parseVitals(encounter?.vitals_json);
    return (
      <div className="border-t pt-4">
        <h4 className="font-semibold text-indigo-800 mb-2">🧪 Laboratory Results</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div className="bg-indigo-50 p-2 rounded">
            <span className="text-gray-600">Malaria RDT:</span>
            <div className={`font-medium ${
              vitals.malaria_rdt === 'positive' ? 'text-red-600' :
              vitals.malaria_rdt === 'negative' ? 'text-green-600' :
              ''
            }`}>
              {vitals.malaria_rdt?.toUpperCase() || 'Not Done'}
            </div>
          </div>
          <div className="bg-indigo-50 p-2 rounded">
            <span className="text-gray-600">Hb (g/dL):</span>
            <div className="font-medium">{vitals.hb || 'N/A'}</div>
          </div>
          <div className="bg-indigo-50 p-2 rounded">
            <span className="text-gray-600">WBC (×10⁹/L):</span>
            <div className="font-medium">{vitals.wbc || 'N/A'}</div>
          </div>
          <div className="bg-indigo-50 p-2 rounded">
            <span className="text-gray-600">HIV Test:</span>
            <div className={`font-medium ${
              vitals.hiv_test === 'positive' ? 'text-red-600' :
              vitals.hiv_test === 'negative' ? 'text-green-600' :
              ''
            }`}>
              {vitals.hiv_test?.toUpperCase() || 'Not Done'}
            </div>
          </div>
          <div className="bg-indigo-50 p-2 rounded">
            <span className="text-gray-600">Blood Group:</span>
            <div className="font-medium">{vitals.blood_group || 'Unknown'}</div>
          </div>
        </div>
        {encounter?.notes && (
          <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
            <span className="text-gray-600">Lab Notes:</span>
            <div>{encounter.notes}</div>
          </div>
        )}
        <div className="mt-2 text-xs text-gray-500">
          Lab Tech: {encounter?.clinician_id} | {new Date(encounter?.created_at).toLocaleString('en-KE')}
        </div>
      </div>
    );
  };

  const renderDoctorReport = (encounter) => {
    const prescriptions = parsePrescriptions(encounter?.prescriptions_json);
    return (
      <div className="border-t pt-4">
        <h4 className="font-semibold text-green-800 mb-2">👨‍⚕️ Doctor Consultation</h4>
        {encounter?.diagnosis_codes && (
          <div className="mb-3 p-3 bg-red-50 rounded">
            <span className="text-gray-600 text-sm">Diagnosis:</span>
            <div className="font-medium text-red-800">{encounter.diagnosis_codes}</div>
          </div>
        )}
        {prescriptions.length > 0 && (
          <div className="mb-3">
            <span className="text-gray-600 text-sm">Prescriptions:</span>
            <div className="mt-1 space-y-1">
              {prescriptions.map((rx, i) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-green-50 rounded text-sm">
                  <span className="font-medium">{rx.drug}</span>
                  <span className="text-gray-500">×{rx.qty}</span>
                  <span className="text-gray-600">({rx.dosage})</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {encounter?.notes && (
          <div className="p-3 bg-gray-50 rounded text-sm">
            <span className="text-gray-600">Doctor Notes:</span>
            <div className="mt-1">{encounter.notes}</div>
          </div>
        )}
        <div className="mt-2 text-xs text-gray-500">
          Doctor: {encounter?.clinician_id} | {new Date(encounter?.created_at).toLocaleString('en-KE')}
        </div>
      </div>
    );
  };

  const renderPharmacyReport = (encounter) => {
    return (
      <div className="border-t pt-4">
        <h4 className="font-semibold text-pink-800 mb-2">💊 Pharmacy Dispensing</h4>
        {encounter?.notes && (
          <div className="p-3 bg-pink-50 rounded text-sm">
            <span className="text-gray-600">Dispensing Notes:</span>
            <div className="mt-1">{encounter.notes}</div>
          </div>
        )}
        <div className="mt-2 text-xs text-gray-500">
          Pharmacist: {encounter?.clinician_id} | {new Date(encounter?.created_at).toLocaleString('en-KE')}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      {/* Navigation Tabs */}
      <div className="flex gap-2 mb-6 border-b">
        <button
          onClick={() => setActiveView('users')}
          className={`px-4 py-2 font-medium ${activeView === 'users' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}
        >
          👥 User Management
        </button>
        <button
          onClick={() => setActiveView('records')}
          className={`px-4 py-2 font-medium ${activeView === 'records' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}
        >
          📋 Patient Records
        </button>
        <button
          onClick={() => setActiveView('reports')}
          className={`px-4 py-2 font-medium ${activeView === 'reports' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-800'}`}
        >
          📊 Reports & Analytics
        </button>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded ${message.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* USER MANAGEMENT VIEW */}
      {activeView === 'users' && (
        <div>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">User Management</h2>
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {showForm ? 'Cancel' : 'Add New User'}
            </button>
          </div>

          {showForm && (
            <div className="bg-white rounded shadow p-6 mb-6">
              <h3 className="text-lg font-semibold mb-4">Create New User</h3>
              <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Staff ID *</label>
                  <input
                    required
                    value={formData.staff_id}
                    onChange={(e) => setFormData({...formData, staff_id: e.target.value})}
                    className="w-full mt-1 p-2 border rounded"
                    placeholder="e.g., NURSE-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Full Name *</label>
                  <input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                    className="w-full mt-1 p-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full mt-1 p-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Phone *</label>
                  <input
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    className="w-full mt-1 p-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Role *</label>
                  <select
                    required
                    value={formData.role}
                    onChange={(e) => setFormData({...formData, role: e.target.value})}
                    className="w-full mt-1 p-2 border rounded"
                  >
                    {ROLES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Department Code *</label>
                  <input
                    required
                    value={formData.department_code}
                    onChange={(e) => setFormData({...formData, department_code: e.target.value})}
                    className="w-full mt-1 p-2 border rounded"
                    placeholder="e.g., TRI-01"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Password *</label>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                    className="w-full mt-1 p-2 border rounded"
                  />
                </div>
                <div className="col-span-2">
                  <button type="submit" className="w-full py-2 bg-green-600 text-white rounded hover:bg-green-700">
                    Create User
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded shadow overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Staff ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="px-4 py-3 text-sm">{u.staff_id}</td>
                    <td className="px-4 py-3 text-sm">{u.name}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs ${
                        u.role === 'admin' ? 'bg-red-100 text-red-800' :
                        u.role === 'doctor' ? 'bg-green-100 text-green-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{u.department_code}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PATIENT RECORDS VIEW */}
      {activeView === 'records' && (
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-6">Patient Records</h2>
          
          {/* Statistics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-800">{stats.total_visits}</div>
              <div className="text-sm text-blue-600">Total Visits</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-2xl font-bold text-green-800">
                {stats.by_stage?.consultation || 0}
              </div>
              <div className="text-sm text-green-600">Seen by Doctor</div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4">
              <div className="text-2xl font-bold text-yellow-800">
                {stats.by_stage?.registration || 0}
              </div>
              <div className="text-sm text-yellow-600">At Reception</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-800">
                {stats.by_gender?.F || 0}/{stats.by_gender?.M || 0}
              </div>
              <div className="text-sm text-purple-600">Female/Male</div>
            </div>
          </div>

          {/* Filter Panel */}
          <div className="bg-white rounded shadow p-4 mb-6 print:hidden">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Visit Hours</label>
                <select
                  value={hourPreset}
                  onChange={(e) => handleHourPresetChange(e.target.value)}
                  className="w-full p-2 border rounded"
                >
                  {HOUR_PRESETS.map(p => (
                    <option key={p.label} value={p.label}>{p.label}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full p-2 border rounded"
                >
                  {DEPARTMENTS.map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              
              <div className="md:col-span-2 lg:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Search Patient</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Name, ID, Phone, or National ID"
                    className="flex-1 p-2 border rounded"
                  />
                  <button
                    onClick={loadRecords}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Search
                  </button>
                </div>
              </div>
            </div>
            
            <div className="flex gap-2 mt-4">
              <button
                onClick={exportToCSV}
                disabled={patients.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                📥 Export CSV
              </button>
              <button
                onClick={printReport}
                disabled={patients.length === 0}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
              >
                🖨️ Print
              </button>
              <button
                onClick={() => {
                  setFromDate(new Date().toISOString().split('T')[0]);
                  setToDate(new Date().toISOString().split('T')[0]);
                  setDepartment('');
                  setSearchQuery('');
                  setHourPreset('All Day');
                  handleHourPresetChange('All Day');
                }}
                className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Results Table */}
          <div className="bg-white rounded shadow overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading records...</div>
            ) : patients.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No patients found for the selected criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Patient ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gender/Age</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Visit Date & Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current Stage</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Complaint</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {patients.map((p, idx) => (
                      <tr key={`${p.patient_id}-${idx}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-mono">{p.patient_id}</td>
                        <td className="px-4 py-3 text-sm font-medium">{p.name}</td>
                        <td className="px-4 py-3 text-sm">{p.phone}</td>
                        <td className="px-4 py-3 text-sm">
                          {p.gender} {p.age ? `(${p.age}y)` : ''}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {new Date(p.visit_date).toLocaleString('en-KE', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded text-xs ${getStageColor(p.current_stage)}`}>
                            {p.current_stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded text-xs ${getStatusColor(p.status)}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{p.department || '-'}</td>
                        <td className="px-4 py-3 text-sm max-w-xs truncate" title={p.chief_complaint}>
                          {p.chief_complaint || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <button
                            onClick={() => setSelectedPatient(p)}
                            className="text-blue-600 hover:text-blue-800 text-xs"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Patient Detail Modal with Clinical Reports */}
          {selectedPatient && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-bold">Patient Clinical Record</h3>
                    <button
                      onClick={() => setSelectedPatient(null)}
                      className="text-gray-500 hover:text-gray-700 text-2xl"
                    >
                      ✕
                    </button>
                  </div>
                  
                  {/* Patient Header Info */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="text-xs text-gray-500">Patient ID</label>
                        <p className="font-mono text-sm">{selectedPatient.patient_id}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">National ID</label>
                        <p className="text-sm">{selectedPatient.national_id || 'N/A'}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Name</label>
                        <p className="font-medium">{selectedPatient.name}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Phone</label>
                        <p className="text-sm">{selectedPatient.phone}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Gender</label>
                        <p className="text-sm">{selectedPatient.gender}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Age</label>
                        <p className="text-sm">{selectedPatient.age ? `${selectedPatient.age} years` : 'N/A'}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Visit Date</label>
                        <p className="text-sm">{new Date(selectedPatient.visit_date).toLocaleString('en-KE')}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Journey Status</label>
                        <span className={`px-2 py-1 rounded text-xs ${getStatusColor(selectedPatient.status)}`}>
                          {selectedPatient.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Clinical Reports by Department */}
                  <div className="space-y-4">
                    {selectedPatient.encounters?.map((enc, i) => (
                      <div key={i} className="border rounded-lg overflow-hidden">
                        {enc.encounter_type === 'triage' && renderTriageReport(enc)}
                        {enc.encounter_type === 'lab' && renderLabReport(enc)}
                        {enc.encounter_type === 'consultation' && renderDoctorReport(enc)}
                        {enc.encounter_type === 'pharmacy' && renderPharmacyReport(enc)}
                        {enc.encounter_type === 'registration' && (
                          <div className="border-t pt-4 p-4">
                            <h4 className="font-semibold text-yellow-800 mb-2">📝 Registration</h4>
                            <div className="text-sm text-gray-600">
                              Checked in at {new Date(enc.created_at).toLocaleString('en-KE')}
                            </div>
                            <div className="text-xs text-gray-500">
                              Reception: {enc.clinician_id}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {(!selectedPatient.encounters || selectedPatient.encounters.length === 0) && (
                      <div className="text-center py-8 text-gray-500">
                        No encounter records found for this patient.
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={() => setSelectedPatient(null)}
                      className="flex-1 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      Close
                    </button>
                    <button
                      onClick={() => window.print()}
                      className="flex-1 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Print Record
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* REPORTS & ANALYTICS VIEW */}
      {activeView === 'reports' && (
        <div>
          <h2 className="text-2xl font-bold text-gray-800 mb-6">Reports & Analytics</h2>
          
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-4 text-white">
              <div className="text-3xl font-bold">{stats.total_visits}</div>
              <div className="text-sm opacity-90">Total Visits</div>
            </div>
            <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg p-4 text-white">
              <div className="text-3xl font-bold">{stats.by_status?.completed || 0}</div>
              <div className="text-sm opacity-90">Completed</div>
            </div>
            <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-lg p-4 text-white">
              <div className="text-3xl font-bold">{stats.by_status?.waiting || 0}</div>
              <div className="text-sm opacity-90">Waiting</div>
            </div>
            <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-4 text-white">
              <div className="text-3xl font-bold">{stats.by_status?.['in-progress'] || 0}</div>
              <div className="text-sm opacity-90">In Progress</div>
            </div>
          </div>

          {/* Department Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Visits by Department</h3>
              <div className="space-y-3">
                {Object.entries(stats.by_stage || {}).map(([stage, count]) => (
                  <div key={stage} className="flex items-center">
                    <div className="w-32 text-sm capitalize">{stage}</div>
                    <div className="flex-1 mx-3">
                      <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full"
                          style={{ width: `${(count / stats.total_visits) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-12 text-right text-sm font-medium">{count}</div>
                  </div>
                ))}
                {Object.keys(stats.by_stage || {}).length === 0 && (
                  <p className="text-gray-500 text-center py-4">No data available</p>
                )}
              </div>
            </div>

            <div className="bg-white rounded shadow p-6">
              <h3 className="text-lg font-semibold mb-4">Gender Distribution</h3>
              <div className="space-y-3">
                {Object.entries(stats.by_gender || {}).map(([gender, count]) => (
                  <div key={gender} className="flex items-center">
                    <div className="w-32 text-sm">{gender === 'F' ? 'Female' : gender === 'M' ? 'Male' : gender}</div>
                    <div className="flex-1 mx-3">
                      <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${gender === 'F' ? 'bg-pink-500' : 'bg-blue-500'}`}
                          style={{ width: `${(count / stats.total_visits) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-12 text-right text-sm font-medium">{count}</div>
                  </div>
                ))}
                {Object.keys(stats.by_gender || {}).length === 0 && (
                  <p className="text-gray-500 text-center py-4">No data available</p>
                )}
              </div>
            </div>
          </div>

          {/* Filter and Export */}
          <div className="bg-white rounded shadow p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Visit Hours</label>
                <select
                  value={hourPreset}
                  onChange={(e) => handleHourPresetChange(e.target.value)}
                  className="w-full p-2 border rounded"
                >
                  {HOUR_PRESETS.map(p => (
                    <option key={p.label} value={p.label}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  onClick={loadRecords}
                  className="w-full py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Generate Report
                </button>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={exportToCSV}
                disabled={patients.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                📥 Export CSV
              </button>
              <button
                onClick={printReport}
                disabled={patients.length === 0}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
              >
                🖨️ Print Report
              </button>
            </div>
          </div>

          {/* Report Preview */}
          <div className="bg-white rounded shadow overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b">
              <h3 className="font-semibold">Report Preview</h3>
              <p className="text-sm text-gray-600">
                {fromDate} to {toDate} • {hourPreset} • {patients.length} records
              </p>
            </div>
            
            {patients.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No records found. Adjust filters and click "Generate Report".
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Stage</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {patients.slice(0, 50).map((p, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm">
                          {new Date(p.visit_date).toLocaleDateString('en-KE')}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-gray-500">{p.patient_id}</div>
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <span className={`px-2 py-1 rounded text-xs ${getStageColor(p.current_stage)}`}>
                            {p.current_stage}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <span className={`px-2 py-1 rounded text-xs ${getStatusColor(p.status)}`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm">{p.department || '-'}</td>
                        <td className="px-4 py-2 text-sm">
                          <button
                            onClick={() => setSelectedPatient(p)}
                            className="text-blue-600 hover:text-blue-800 text-xs"
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {patients.length > 50 && (
                  <div className="p-4 text-center text-sm text-gray-500">
                    Showing 50 of {patients.length} records. Export CSV to see all.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Patient Detail Modal in Reports View */}
          {selectedPatient && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-xl font-bold">Patient Clinical Record</h3>
                    <button
                      onClick={() => setSelectedPatient(null)}
                      className="text-gray-500 hover:text-gray-700 text-2xl"
                    >
                      ✕
                    </button>
                  </div>
                  
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <label className="text-xs text-gray-500">Patient ID</label>
                        <p className="font-mono text-sm">{selectedPatient.patient_id}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Name</label>
                        <p className="font-medium">{selectedPatient.name}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Visit Date</label>
                        <p className="text-sm">{new Date(selectedPatient.visit_date).toLocaleString('en-KE')}</p>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Status</label>
                        <span className={`px-2 py-1 rounded text-xs ${getStatusColor(selectedPatient.status)}`}>
                          {selectedPatient.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {selectedPatient.encounters?.map((enc, i) => (
                      <div key={i} className="border rounded-lg overflow-hidden">
                        {enc.encounter_type === 'triage' && renderTriageReport(enc)}
                        {enc.encounter_type === 'lab' && renderLabReport(enc)}
                        {enc.encounter_type === 'consultation' && renderDoctorReport(enc)}
                        {enc.encounter_type === 'pharmacy' && renderPharmacyReport(enc)}
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={() => setSelectedPatient(null)}
                      className="flex-1 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function calculateAge(dob) {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}