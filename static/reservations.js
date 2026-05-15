// reservations.js — reservation preview and creation.
// Depends on: api.js  (apiPreviewReservation, apiCreateReservation)
//             slots.js (loadSlots)
//             ui.js    (loadRecords)  — loaded after this file

let _previewDebounce = null;

function clearResPreview() {
  document.getElementById('res-preview').style.display = 'none';
}

async function previewRes() {
  const entry  = document.getElementById('res-entry').value;
  const exit_  = document.getElementById('res-exit').value;
  const vtSel  = document.getElementById('res-vtype');
  const vtId   = vtSel ? parseInt(vtSel.value || 1) : 1;
  if (!entry || !exit_) return;

  clearTimeout(_previewDebounce);
  _previewDebounce = setTimeout(async () => {
    const { ok, data } = await apiPreviewReservation(entry, exit_, vtId);
    const preview = document.getElementById('res-preview');

    if (!ok) {
      preview.style.display = 'none';
      const msg = document.getElementById('res-msg');
      msg.textContent = data.error;
      msg.className   = 'msg err';
      return;
    }

    document.getElementById('res-msg').textContent = '';
    document.getElementById('preview-rate').textContent =
      `$${data.hourly_rate.toFixed(2)} / hr`;
    document.getElementById('preview-duration').textContent =
      `${data.hours}h ${data.minutes}m`;
    document.getElementById('preview-billed').textContent =
      `${data.billed_hours} hr${data.billed_hours !== 1 ? 's' : ''}`;
    document.getElementById('preview-amount').textContent =
      `$${data.amount.toFixed(2)}`;
    document.getElementById('preview-note').textContent =
      `$${data.hourly_rate.toFixed(2)} / hour · billed per hour (ceil)`;
    preview.style.display = 'block';
  }, 300);
}

async function createReservation() {
  const vehicle = document.getElementById('res-vehicle').value.trim().toUpperCase();
  const slot    = document.getElementById('res-slot').value.trim().toUpperCase();
  const entry   = document.getElementById('res-entry').value;
  const exit_   = document.getElementById('res-exit').value;
  const vtSel   = document.getElementById('res-vtype');
  const vtId    = vtSel ? parseInt(vtSel.value || 1) : 1;
  const msg     = document.getElementById('res-msg');

  if (!vehicle) { msg.textContent = 'Enter vehicle number.'; msg.className = 'msg err'; return; }
  if (!slot)    { msg.textContent = 'Enter slot number.';    msg.className = 'msg err'; return; }
  if (!entry)   { msg.textContent = 'Enter entry time.';     msg.className = 'msg err'; return; }
  if (!exit_)   { msg.textContent = 'Enter exit time.';      msg.className = 'msg err'; return; }

  const { ok, data } = await apiCreateReservation(vehicle, slot, entry, exit_, vtId);
  msg.textContent = ok
    ? `${data.message} Amount: $${data.amount.toFixed(2)}`
    : data.error;
  msg.className = ok ? 'msg' : 'msg err';

  if (ok) {
    document.getElementById('res-vehicle').value = '';
    document.getElementById('res-slot').value    = '';
    document.getElementById('res-entry').value   = '';
    document.getElementById('res-exit').value    = '';
    document.getElementById('res-preview').style.display = 'none';

    // Clear slot selection so the grid re-renders without the blue highlight
    selectedSlot = null;
    document.getElementById('selected-slot-label').textContent = 'No slot selected';
    document.getElementById('selected-slot-type').style.display = 'none';
    document.getElementById('assign-btn').disabled = true;
    document.getElementById('res-slot').style.borderColor = '';

    loadSlots();
    loadRecords();
  }
}