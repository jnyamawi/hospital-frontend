import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/Login';
import AdminDashboard from './components/AdminDashboard';
import PatientForm from './components/PatientForm';
import PatientList from './components/PatientList';
import TriageForm from './components/TriageForm';
import LabForm from './components/LabForm';
import DoctorForm from './components/DoctorForm';
import PharmacyForm from './components/PharmacyForm';
import SyncStatus from './components/SyncStatus';

function AppContent() {
  const { user, logout, hasRole, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('register');

  // Fix: useEffect instead of useState for side effects
  useEffect(() => {
    if (user) {
      const tabs = [];
      if (hasRole(['admin', 'receptionist'])) {
        tabs.push('register');
        tabs.push('list');
      }
      if (hasRole(['admin', 'triage_nurse'])) tabs.push('triage');
      if (hasRole(['admin', 'lab_technician'])) tabs.push('lab');
      if (hasRole(['admin', 'doctor'])) tabs.push('consultation');
      if (hasRole(['admin', 'pharmacist'])) tabs.push('pharmacy');
      if (hasRole(['admin'])) tabs.push('admin');
      
      // If current activeTab is not in available tabs, switch to first available
      if (tabs.length > 0 && !tabs.includes(activeTab)) {
        setActiveTab(tabs[0]);
      }
    }
  }, [user]); // Run when user changes

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return <Login />;
  }

  const getRoleColor = () => {
    const colors = {
      admin: 'bg-purple-800',
      receptionist: 'bg-blue-800',
      triage_nurse: 'bg-yellow-700',
      lab_technician: 'bg-indigo-700',
      doctor: 'bg-green-700',
      pharmacist: 'bg-pink-700'
    };
    return colors[user.role] || 'bg-gray-700';
  };

  const getRoleName = () => {
    const names = {
      admin: 'Administrator',
      receptionist: 'Reception',
      triage_nurse: 'Triage Nurse',
      lab_technician: 'Lab Technician',
      doctor: 'Doctor',
      pharmacist: 'Pharmacist'
    };
    return names[user.role] || user.role;
  };

  const tabs = [];

  // Build tabs based on role
  if (hasRole(['admin', 'receptionist'])) {
    tabs.push({ id: 'register', label: 'Patient Reception', component: <PatientForm /> });
    tabs.push({ id: 'list', label: 'View Records', component: <PatientList /> });
  }

  if (hasRole(['admin', 'triage_nurse'])) {
    tabs.push({ id: 'triage', label: 'Triage', component: <TriageForm /> });
  }

  if (hasRole(['admin', 'lab_technician'])) {
    tabs.push({ id: 'lab', label: 'Laboratory', component: <LabForm /> });
  }

  if (hasRole(['admin', 'doctor'])) {
    tabs.push({ id: 'consultation', label: 'Doctor', component: <DoctorForm /> });
  }

  if (hasRole(['admin', 'pharmacist'])) {
    tabs.push({ id: 'pharmacy', label: 'Pharmacy', component: <PharmacyForm /> });
  }

  if (hasRole(['admin'])) {
    tabs.push({ id: 'admin', label: 'Admin Panel', component: <AdminDashboard /> });
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className={`${getRoleColor()} text-white p-4 shadow`}>
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold">Hospital Offline System</h1>
            <p className="text-xs opacity-80">
              {getRoleName()} | {user.name} | {user.staff_id}
            </p>
          </div>
          <button 
            onClick={logout}
            className="text-xs bg-white bg-opacity-20 px-3 py-1 rounded hover:bg-opacity-30"
          >
            Logout
          </button>
        </div>
      </header>

      {tabs.length > 1 && (
        <nav className="flex gap-1 p-2 bg-white shadow-sm overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'bg-blue-100 text-blue-800 font-medium' 
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      <main className="p-4">
        {tabs.find(t => t.id === activeTab)?.component}
      </main>

      <SyncStatus />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}