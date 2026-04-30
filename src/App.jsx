import { useState } from 'react';
import { db } from './db/schema';
import DepartmentSelector from './components/DepartmentSelector';
import PatientForm from './components/PatientForm';
import PatientList from './components/PatientList';
import TriageForm from './components/TriageForm';
import DoctorForm from './components/DoctorForm';
import SyncStatus from './components/SyncStatus';

export default function App() {
  const [department, setDepartment] = useState(db.getDepartment());
  const [showSelector, setShowSelector] = useState(false);

  const handleDepartmentChange = (dept) => {
    setDepartment(dept);
    setShowSelector(false);
  };

  const getDepartmentName = () => {
    const names = {
      reception: 'Reception / Registration',
      triage: 'Triage / Vitals',
      consultation: 'Doctor Consultation'
    };
    return names[department] || 'Unknown';
  };

  const getDepartmentColor = () => {
    const colors = {
      reception: 'bg-blue-800',
      triage: 'bg-yellow-700',
      consultation: 'bg-green-700'
    };
    return colors[department] || 'bg-gray-700';
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <header className={`${getDepartmentColor()} text-white p-4 shadow`}>
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold">Hospital Offline System</h1>
            <p className="text-xs opacity-80">{getDepartmentName()}</p>
          </div>
          <button 
            onClick={() => setShowSelector(!showSelector)}
            className="text-xs bg-white bg-opacity-20 px-3 py-1 rounded hover:bg-opacity-30"
          >
            Switch Dept
          </button>
        </div>
      </header>

      {showSelector && (
        <div className="p-4">
          <DepartmentSelector onSelect={handleDepartmentChange} />
        </div>
      )}

      {!showSelector && (
        <>
          {department === 'reception' && (
            <nav className="flex gap-1 p-2 bg-white shadow-sm">
              <button 
                onClick={() => window.location.hash = '#register'}
                className="flex-1 py-2 rounded bg-blue-100 text-blue-800 font-medium"
              >
                Register Patient
              </button>
              <button 
                onClick={() => window.location.hash = '#list'}
                className="flex-1 py-2 rounded text-gray-600 hover:bg-gray-100"
              >
                View Records
              </button>
            </nav>
          )}

          <main className="p-4">
            {department === 'reception' && (
              <>
                {window.location.hash === '#list' ? <PatientList /> : <PatientForm />}
              </>
            )}
            {department === 'triage' && <TriageForm />}
            {department === 'consultation' && <DoctorForm />}
          </main>
        </>
      )}
      
      <SyncStatus />
    </div>
  );
}