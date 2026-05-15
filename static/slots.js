// slots.js — slot grid rendering and click-selection logic.
// Depends on: api.js  (apiGetSlots)
// Exposes globals: selectedSlot, selectSlot(), renderSlots(), loadSlots()

let selectedSlot = null;

// ── Slot badge config ────────────────────────────────────────────────────────

const SLOT_TYPE_CFG = {
  Regular:     { label: '■ Regular',     color: 'var(--green)',  bg: 'rgba(0,255,157,0.08)' },
  EV:          { label: '■ EV',          color: 'var(--accent)', bg: 'rgba(0,111,214,0.1)'  },
  Handicapped: { label: '■ Handicapped', color: '#a050dc',       bg: 'rgba(160,80,220,0.1)' },
};

// ── HTML builders ────────────────────────────────────────────────────────────

function fmtResTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function makeSlot(s) {
  const isActive   = s.is_reserved;
  const isUpcoming = !s.is_occupied && !s.is_reserved && !!s.next_res_start;
  const isBlocked  = s.is_occupied || isActive;  // upcoming = still clickable
  const cls        = s.is_occupied ? 'occupied'
                   : (isActive || isUpcoming) ? (isUpcoming ? 'reserved free-walkin' : 'reserved')
                   : 'free';
  const selected   = selectedSlot === s.slot_number ? 'selected' : '';
  const typeClass  = s.slot_type === 'EV' ? 'ev' : s.slot_type === 'Handicapped' ? 'handicapped' : '';
  const icon       = s.slot_type === 'EV' ? '' : s.slot_type === 'Handicapped' ? '' : '';
  const onclick    = isBlocked ? '' : `onclick="selectSlot('${s.slot_number}')"`;

  let pill = '';
  if (isActive) {
    pill = `<span class="res-pill res-pill--now">Active</span>`;
  } else if (isUpcoming) {
    pill = `<span class="res-pill res-pill--soon">Upcoming</span>`;
  }

  const statusLabel = s.is_occupied ? 'Occ' : (isActive || isUpcoming) ? 'Res' : 'Free';
  return `<div class="slot ${cls} ${typeClass} ${selected}" ${onclick}>${icon}${s.slot_number}<span class="slot-status">${statusLabel}</span>${pill}</div>`;
}

function makeAisle() {
  return `<div class="slot-aisle"></div>`;
}

// ── System Status ─────────────────────────────────────────────────────────────

function updateSystemStatus(slots) {
  const container = document.getElementById('sys-stats');
  if (!container) return;

  const total    = slots.length;
  const occupied = slots.filter(s => s.is_occupied).length;
  const reserved = slots.filter(s => !s.is_occupied && (s.is_reserved || !!s.next_res_start)).length;
  const free     = slots.filter(s => !s.is_occupied && !s.is_reserved && !s.next_res_start).length;
  const evFree   = slots.filter(s => s.slot_type === 'EV'          && !s.is_occupied && !s.is_reserved && !s.next_res_start).length;
  const hcFree   = slots.filter(s => s.slot_type === 'Handicapped' && !s.is_occupied && !s.is_reserved && !s.next_res_start).length;

  const row = (label, value, color) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0.75rem;">
      <span style="color:var(--muted);letter-spacing:0.06em;">${label}</span>
      <span style="color:${color};font-weight:bold;">${value}</span>
    </div>`;

  container.innerHTML =
    row('Total Slots', total,    'var(--text)')  +
    row('Free',        free,     'var(--green)') +
    row('Occupied',    occupied, 'var(--red)')   +
    row('Reserved',    reserved, '#ca8a04')      +
    row('EV Free',     evFree,   'var(--accent)') +
    row('HC Free',     hcFree,   '#a050dc');
}

// Start the clock (runs once, updates every second)
(function startClock() {
  function tick() {
    const el = document.getElementById('sys-clock');
    if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }
  tick();
  setInterval(tick, 1000);
})();



function renderSlots(slots) {
  window._lastSlots = slots;
  updateSystemStatus(slots);
  const grid = document.getElementById('slots-grid');

  const rows = {};
  slots.forEach(s => {
    const row = s.slot_number[0];
    if (!rows[row]) rows[row] = [];
    rows[row].push(s);
  });

  let html = '';
  Object.keys(rows).sort().forEach(row => {
    const r = rows[row].sort((a, b) =>
      parseInt(a.slot_number.slice(1)) - parseInt(b.slot_number.slice(1))
    );

    if ('EFG'.includes(row)) {
      html += `<div class="slot-row"><div class="slot-section">${r.map(makeSlot).join('')}</div></div>`;
    } else {
      const left   = r.filter(s => parseInt(s.slot_number.slice(1)) <= 4);
      const middle = r.filter(s => parseInt(s.slot_number.slice(1)) >= 5 && parseInt(s.slot_number.slice(1)) <= 12);
      const right  = r.filter(s => parseInt(s.slot_number.slice(1)) >= 13);
      html += `<div class="slot-row">
        <div class="slot-section">${left.map(makeSlot).join('')}</div>
        ${makeAisle()}
        <div class="slot-section">${middle.map(makeSlot).join('')}</div>
        ${makeAisle()}
        <div class="slot-section">${right.map(makeSlot).join('')}</div>
        <div style="flex:1"></div>
      </div>`;
    }
  });

  grid.innerHTML = html;
}

// ── Load ─────────────────────────────────────────────────────────────────────

async function loadSlots() {
  const { ok, data: slots } = await apiGetSlots();
  if (!ok || !slots.length) {
    document.getElementById('slots-grid').innerHTML = '<div class="empty">No slots found.</div>';
    return;
  }
  renderSlots(slots);
}

// ── Selection ────────────────────────────────────────────────────────────────

function selectSlot(slotNumber) {
  selectedSlot = selectedSlot === slotNumber ? null : slotNumber;

  // Entry card label + button
  document.getElementById('selected-slot-label').textContent = selectedSlot
    ? `Selected: ${selectedSlot}`
    : 'No slot selected';
  document.getElementById('assign-btn').disabled = !selectedSlot;

  // Sync reservation slot field
  const resSlotInput = document.getElementById('res-slot');
  if (selectedSlot) {
    resSlotInput.value = selectedSlot;
    resSlotInput.style.borderColor = 'var(--accent)';
    clearResPreview();          // defined in reservations.js
  } else {
    resSlotInput.value = '';
    resSlotInput.style.borderColor = '';
  }

  // Type badge next to the entry field
  const badge = document.getElementById('selected-slot-type');
  if (selectedSlot) {
    const slot = (window._lastSlots || []).find(s => s.slot_number === selectedSlot);
    const type = slot ? slot.slot_type : 'Regular';
    const cfg  = SLOT_TYPE_CFG[type] || { label: type, color: 'var(--muted)', bg: 'transparent' };
    badge.textContent        = cfg.label;
    badge.style.color        = cfg.color;
    badge.style.borderColor  = cfg.color;
    badge.style.background   = cfg.bg;
    badge.style.display      = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  renderSlots(window._lastSlots || []);
}