import Dexie from 'dexie';

class HospitalDB extends Dexie {
  constructor() {
    super('HospitalDB');
    
    // Version 8: Add locked_by field for multi-device locking
    this.version(8).stores({
      patients: '++local_id, server_id, national_id, phone, name, facility_code, sync_status, device_id, version, updated_at',
      encounters: '++local_id, server_id, patient_local_id, encounter_type, parent_encounter_id, department_code, facility_code, sync_status, device_id, version, updated_at',
      bills: '++local_id, server_id, encounter_local_id, payment_status, sync_status, device_id, version, updated_at',
      patientJourney: '++id, patient_local_id, current_stage, next_stage, status, locked_by, sync_status, updated_at',  // ← ADDED: locked_by index
      syncQueue: '++id, table_name, local_id, action, priority, timestamp, retry_count, last_error',
      meta: 'key'
    });
  }

  generateTempId(prefix = 'TMP') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${timestamp}-${random}`.toUpperCase();
  }

  async queueForSync(tableName, localId, priority = 99) {
    // Prevent duplicate queue entries
    const existing = await this.syncQueue
      .where({ table_name: tableName, local_id: localId })
      .first();
    
    if (existing) {
      // Update priority if higher
      if (priority < existing.priority) {
        await this.syncQueue.update(existing.id, { priority });
      }
      return;
    }

    await this.syncQueue.add({
      table_name: tableName,
      local_id: localId,
      action: 'push',
      priority: priority,
      timestamp: new Date().toISOString(),
      retry_count: 0
    });
  }

  // FIXED: crypto.randomUUID is not available on non-secure contexts (HTTP over network)
  getDeviceId() {
    let deviceId = localStorage.getItem('device_id');
    if (!deviceId) {
      const generateUUID = () => {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          return crypto.randomUUID();
        }
        // Manual UUID v4 generation for HTTP/non-secure contexts
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0;
          const v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      };
      deviceId = `DEV-${generateUUID().substring(0, 8)}`;
      localStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  }

  // PATIENT JOURNEY HELPERS

  async updatePatientJourney(patientLocalId, stage, nextStage, status = 'waiting') {
    const existing = await this.patientJourney
      .where('patient_local_id')
      .equals(patientLocalId)
      .first();
    
    const now = new Date().toISOString();
    const deviceId = this.getDeviceId();
    
    if (existing) {
      const newVersion = (existing.version || 0) + 1;
      await this.patientJourney.update(existing.id, {
        current_stage: stage,
        next_stage: nextStage,
        status: status,
        sync_status: 'pending',
        version: newVersion,
        updated_at: now
      });
      // Queue by patient_local_id (string) for backend sync
      await this.queueForSync('patientJourney', existing.patient_local_id, 1);
    } else {
      await this.patientJourney.add({
        patient_local_id: patientLocalId,
        current_stage: stage,
        next_stage: nextStage,
        status: status,
        sync_status: 'pending',
        device_id: deviceId,
        version: 1,
        created_at: now,
        updated_at: now
      });
      // Queue by patient_local_id (string) for backend sync
      await this.queueForSync('patientJourney', patientLocalId, 1);
    }
  }

  // NEW: Lock patient for multi-device cooperation
  async lockPatient(patientLocalId, staffId) {
    const journey = await this.patientJourney
      .where('patient_local_id')
      .equals(patientLocalId)
      .first();
    
    if (journey && !journey.locked_by) {
      const newVersion = (journey.version || 0) + 1;
      await this.patientJourney.update(journey.id, {
        status: 'in-progress',
        locked_by: staffId,
        sync_status: 'pending',
        version: newVersion,
        updated_at: new Date().toISOString()
      });
      // Queue for immediate sync to notify other devices
      await this.queueForSync('patientJourney', journey.patient_local_id, 1);
      return true; // Successfully locked
    }
    return false; // Already locked by someone else
  }

  // NEW: Unlock patient (when nurse cancels or on error)
  async unlockPatient(patientLocalId) {
    const journey = await this.patientJourney
      .where('patient_local_id')
      .equals(patientLocalId)
      .first();
    
    if (journey && journey.locked_by) {
      const newVersion = (journey.version || 0) + 1;
      await this.patientJourney.update(journey.id, {
        status: 'waiting',
        locked_by: null,
        sync_status: 'pending',
        version: newVersion,
        updated_at: new Date().toISOString()
      });
      await this.queueForSync('patientJourney', journey.patient_local_id, 1);
      return true;
    }
    return false;
  }

  async getPatientsAtStage(stage) {
    const journeys = await this.patientJourney
      .where('current_stage')
      .equals(stage)
      .and(j => j.status === 'waiting' || j.status === 'in-progress')
      .toArray();
    
    const patients = [];
    for (const journey of journeys) {
      const patient = await this.patients.get(journey.patient_local_id);
      if (patient) {
        const encounters = await this.encounters
          .where('patient_local_id')
          .equals(journey.patient_local_id)
          .toArray();
        
        const lastEncounter = encounters
          .filter(e => e.encounter_type === stage)
          .sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at))[0];
        
        patients.push({
          ...patient,
          journey: journey,
          lastEncounter: lastEncounter,
          allEncounters: encounters
        });
      }
    }
    return patients;
  }

  async getPatientsForStage(stage) {
    const journeys = await this.patientJourney
      .where('next_stage')
      .equals(stage)
      .and(j => j.status === 'waiting' || j.status === 'in-progress')  // ← CHANGED: include in-progress
      .toArray();
    
    const patients = [];
    for (const journey of journeys) {
      const patient = await this.patients.get(journey.patient_local_id);
      if (patient) {
        const encounters = await this.encounters
          .where('patient_local_id')
          .equals(journey.patient_local_id)
          .toArray();
        
        patients.push({
          ...patient,
          journey: journey,
          encounters: encounters.sort((a, b) => new Date(a.created_at || a.updated_at) - new Date(b.created_at || b.updated_at))
        });
      }
    }
    return patients;
  }

  // FIXED: completeStage now sets status='completed' when journey is finished
  // NEW: Also clears locked_by when completing stage
  async completeStage(patientLocalId, nextStage) {
    const journey = await this.patientJourney
      .where('patient_local_id')
      .equals(patientLocalId)
      .first();
    
    if (journey) {
      const newVersion = (journey.version || 0) + 1;
      
      // Determine if this is the final stage of the journey
      const isFinalStage = nextStage === 'completed' || nextStage === 'done' || nextStage === 'finished';
      
      await this.patientJourney.update(journey.id, {
        current_stage: journey.next_stage,      // e.g., pharmacy → becomes current
        next_stage: nextStage,                   // 'completed' → becomes next
        status: isFinalStage ? 'completed' : 'waiting',  // ← FIX: completed when done
        locked_by: isFinalStage ? null : journey.locked_by,  // ← NEW: clear lock when done
        sync_status: 'pending',
        version: newVersion,
        updated_at: new Date().toISOString()
      });
      
      // FIXED: Use patient_local_id (string) not local_id (number)
      await this.queueForSync('patientJourney', journey.patient_local_id, 1);
    }
  }

  async getPatientJourneyStatus(patientLocalId) {
    const journey = await this.patientJourney
      .where('patient_local_id')
      .equals(patientLocalId)
      .first();
    
    if (!journey) return null;
    
    const patient = await this.patients.get(patientLocalId);
    const encounters = await this.encounters
      .where('patient_local_id')
      .equals(patientLocalId)
      .toArray();
    
    return {
      patient,
      journey,
      encounters: encounters.sort((a, b) => new Date(a.created_at || a.updated_at) - new Date(b.created_at || b.updated_at))
    };
  }
}

export const db = new HospitalDB();