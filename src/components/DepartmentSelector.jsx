 import { useState } from 'react';
import { db } from '../db/schema';

export default function DepartmentSelector({ onSelect }) {
  const [selected, setSelected] = useState(db.getDepartment());

  const departments = [
    { code: 'reception', name: 'Reception / Registration', color: 'bg-blue-600' },
    { code: 'triage', name: 'Triage / Vitals', color: 'bg-yellow-600' },
    { code: 'consultation', name: 'Doctor Consultation', color: 'bg-green-600' },
  ];

  const handleSelect = (dept) => {
    db.setDepartment(dept.code);
    setSelected(dept.code);
    onSelect?.(dept.code);
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Select Department</h2>
      <p className="text-sm text-gray-600 mb-4">
        This device will be assigned to one department. Each tablet in the hospital uses its own department view.
      </p>
      
      <div className="space-y-3">
        {departments.map(dept => (
          <button
            key={dept.code}
            onClick={() => handleSelect(dept)}
            className={`w-full p-4 rounded-lg text-white font-medium text-left transition ${
              selected === dept.code ? `${dept.color} ring-4 ring-offset-2 ring-gray-300` : `${dept.color} opacity-70 hover:opacity-100`
            }`}
          >
            <div className="text-lg">{dept.name}</div>
            <div className="text-xs opacity-80 mt-1">
              {selected === dept.code ? '✓ Currently active' : 'Click to activate'}
            </div>
          </button>
        ))}
      </div>
      
      <div className="mt-4 p-3 bg-gray-50 rounded text-xs text-gray-600">
        <strong>Device ID:</strong> {db.getDeviceId()}<br/>
        <strong>Current Department:</strong> {selected}
      </div>
    </div>
  );
}
