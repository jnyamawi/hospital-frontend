import Dexie from 'dexie';

class HospitalDB extends Dexie {
  constructor() {
    super('HospitalDB');
    
    this.version(2).stores({
      // Existing tables
      patients: '++local_id, server_id, national_id, phone, name, facility_code, sync_status, device_id, version, updated_at',
      encounters: '++local_id, server_id, patient_local_id, encounter_type, parent_encounter_id, department_code, facility_code, sync_status, device_id, version, updated_at',
      bills: '++local_id, server_id, encounter_local_id, payment_status, sync_status, device_id, version, updated_at',
      syncQueue: '++id, table_name, local_id, action, priority, timestamp, retry_count',
      meta: 'key'
    });
  }

  generateTempId(prefix = 'TMP') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${timestamp}-${random}`.toUpperCase();
  }

  async queueForSync(tableName, localId, priority = 99) {
    await this.syncQueue.add({
      table_name: tableName,
      local_id: localId,
      action: 'push',
      priority: priority,
      timestamp: new Date().toISOString(),
      retry_count: 0
    });
  }

  getDeviceId() {
    let deviceId = localStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = `DEV-${crypto.randomUUID().substring(0, 8)}`;
      localStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  }

  getDepartment() {
    return localStorage.getItem('department') || 'reception';
  }

  setDepartment(dept) {
    localStorage.setItem('department', dept);
  }

  // Get patients who need triage (registered today, no triage encounter)
  async getPatientsNeedingTriage() {
    const today = new Date().toISOString().split('T')[0];
    const allPatients = await this.patients
      .where('updated_at')
      .startsWith(today)
      .toArray();
    
    const triageEncounters = await this.encounters
      .where('encounter_type')
      .equals('triage')
      .toArray();
    
    const triagedPatientIds = new Set(triageEncounters.map(e => e.patient_local_id));
    
    return allPatients.filter(p => !triagedPatientIds.has(p.local_id));
  }

  // Get patients ready for doctor (triaged today, no consultation)
  async getPatientsForDoctor() {
    const today = new Date().toISOString().split('T')[0];
    
    const triageEncounters = await this.encounters
      .where('encounter_type')
      .equals('triage')
      .toArray();
    
    const consultationEncounters = await this.encounters
      .where('encounter_type')
      .equals('consultation')
      .toArray();
    
    const consultedPatientIds = new Set(consultationEncounters.map(e => e.patient_local_id));
    
    return triageEncounters.filter(e => !consultedPatientIds.has(e.patient_local_id));
  }

  // Get full patient journey
  async getPatientJourney(patientLocalId) {
    const patient = await this.patients.get(patientLocalId);
    const encounters = await this.encounters
      .where('patient_local_id')
      .equals(patientLocalId)
      .sortBy('updated_at');
    
    return { patient, encounters };
  }
}

export const db = new HospitalDB();