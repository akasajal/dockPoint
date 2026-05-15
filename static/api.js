// api.js — fetch wrappers for every backend endpoint.
// All functions return { ok, data } so callers never touch Response directly.

async function _json(res) {
  const data = await res.json();
  return { ok: res.ok, data };
}

async function apiGetVehicleTypes() {
  return _json(await fetch('/vehicle-types'));
}

async function apiGetSlots() {
  return _json(await fetch('/slots'));
}

async function apiGetRecords() {
  return _json(await fetch('/records'));
}

async function apiAssignSlot(vehicleNumber, slotNumber, vehicleTypeId) {
  return _json(await fetch('/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_number: vehicleNumber, slot_number: slotNumber, vehicle_type_id: vehicleTypeId }),
  }));
}

async function apiReleaseSlot(vehicleNumber) {
  return _json(await fetch('/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_number: vehicleNumber }),
  }));
}

async function apiPreviewReservation(entryTime, exitTime, vehicleTypeId) {
  return _json(await fetch('/reservations/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry_time: entryTime, exit_time: exitTime, vehicle_type_id: vehicleTypeId }),
  }));
}

async function apiCreateReservation(vehicleNumber, slotNumber, entryTime, exitTime, vehicleTypeId) {
  return _json(await fetch('/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vehicle_number:  vehicleNumber,
      slot_number:     slotNumber,
      entry_time:      entryTime,
      exit_time:       exitTime,
      vehicle_type_id: vehicleTypeId,
    }),
  }));
}