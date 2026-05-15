// ui.js — vehicle entry/exit handlers, records table rendering, and app bootstrap.
// Depends on: api.js         (apiAssignSlot, apiReleaseSlot, apiGetRecords, apiGetVehicleTypes)
//             slots.js       (selectedSlot, loadSlots, renderSlots)
//             reservations.js (no direct deps here)

// ── Vehicle types ────────────────────────────────────────────────────────────

let _vehicleTypes = [];
let _myVehicles   = [];   // cached registered vehicles for type auto-lookup

async function loadVehicleTypes() {
  const { ok, data } = await apiGetVehicleTypes();
  if (!ok) return;
  _vehicleTypes = data;

  // Walk-in entry: type name only. Reservation: type name + rate.
  const optsPlain = data.map(vt =>
    `<option value="${vt.id}">${vt.type_name}</option>`
  ).join('');
  const optsWithRate = data.map(vt =>
    `<option value="${vt.id}">${vt.type_name} — $${vt.hourly_rate.toFixed(2)}/hr</option>`
  ).join('');

  const assignEl = document.getElementById('assign-vtype');
  if (assignEl) assignEl.innerHTML =
    `<option value="" disabled selected>Choose type</option>` + optsPlain;

  const resEl = document.getElementById('res-vtype');
  if (resEl) resEl.innerHTML =
    `<option value="" disabled selected>Choose type</option>` + optsWithRate;
}

// ── Vehicle type auto-lookup for entry form ───────────────────────────────────

let _lookupDebounce = null;

function lookupVehicleType() {
  clearTimeout(_lookupDebounce);
  _lookupDebounce = setTimeout(() => {
    const raw     = document.getElementById('assign-vehicle').value.trim().toUpperCase();
    const resRaw  = document.getElementById('res-vehicle').value.trim().toUpperCase();
    const display = document.getElementById('assign-vtype-display');
    const label   = document.getElementById('assign-vtype-label');
    const select  = document.getElementById('assign-vtype');

    const isOwner = !!(document.getElementById('modal-profile')); // modals only exist for owners

    // Entry form lookup
    const match = _myVehicles.find(v => v.vehicle_number === raw);
    if (match) {
      label.textContent              = `𖠌 ${match.type_name}`;
      display.style.display          = 'flex';
      display.style.borderColor      = 'var(--green)';
      display.style.color            = 'var(--green)';
      select.style.display           = 'none';
      select.dataset.autoVtId        = match.vehicle_type_id;
    } else if (isOwner) {
      label.textContent              = raw ? 'vehicle not found' : '— type a vehicle number';
      display.style.display          = 'flex';
      display.style.borderColor      = raw ? 'var(--red)' : 'var(--border)';
      display.style.color            = raw ? 'var(--red)' : 'var(--muted)';
      select.style.display           = 'none';
      delete select.dataset.autoVtId;
    } else {
      display.style.display          = 'none';
      select.style.display           = '';
      delete select.dataset.autoVtId;
    }

    // Reservation form lookup
    const resMatch  = _myVehicles.find(v => v.vehicle_number === resRaw);
    const resSel    = document.getElementById('res-vtype');
    const resDisp   = document.getElementById('res-vtype-display');
    const resLabel  = document.getElementById('res-vtype-label');
    if (resSel && resDisp) {
      if (resMatch) {
        resSel.value                 = resMatch.vehicle_type_id;
        resLabel.textContent         = `𖠌 ${resMatch.type_name}`;
        resDisp.style.display        = 'flex';
        resDisp.style.borderColor    = 'var(--green)';
        resDisp.style.color          = 'var(--green)';
        resSel.style.display         = 'none';
        resSel.dispatchEvent(new Event('change'));
      } else if (isOwner) {
        resLabel.textContent         = resRaw ? 'vehicle not found' : '— type a vehicle number';
        resDisp.style.display        = 'flex';
        resDisp.style.borderColor    = resRaw ? 'var(--red)' : 'var(--border)';
        resDisp.style.color          = resRaw ? 'var(--red)' : 'var(--muted)';
        resSel.style.display         = 'none';
      } else {
        resDisp.style.display        = 'none';
        resSel.style.display         = '';
      }
    }
  }, 200);
}



async function loadRecords() {
  const { ok, data: records } = await apiGetRecords();
  const container = document.getElementById('records-container');
  if (!ok || !records.length) {
    container.innerHTML = '<div class="empty">No records yet.</div>';
    return;
  }

  // Build vehicle+slot → reservation exit time lookup for "still parked" rows
  const resLookup = {};
  records.forEach(r => {
    if (r.booking_type === 'Reservation') {
      resLookup[`${r.vehicle_number}|${r.slot_number}`] = r.exit_time;
    }
  });

  container.innerHTML = `
    <table>
      <thead>
        <tr><th>ID</th><th>Vehicle</th><th>Slot</th><th>Type</th><th>Booking Type</th><th>Entry</th><th>Exit</th></tr>
      </thead>
      <tbody>
        ${records.map(r => {
          const isReservation = r.booking_type === 'Reservation';
          const isStill       = r.exit_time === 'Still parked';
          let exitCell        = r.exit_time;

          if (isStill) {
            const tentative = resLookup[`${r.vehicle_number}|${r.slot_number}`];
            exitCell = `Still parked${tentative
              ? `<br><span style="font-size:0.68rem;opacity:0.6;letter-spacing:0.04em">~ out by ${tentative}</span>`
              : ''}`;
          }

        //   const amountCell = r.amount != null
        //     ? `<td class="amount-col">$${r.amount.toFixed(2)}</td>`
        //     : `<td class="${isStill ? 'still' : 'exited'}">—</td>`;

          return `
            <tr>
              <td>${r.display_id}</td>
              <td>${r.vehicle_number}</td>
              <td>${r.slot_number}</td>
              <td style="color:var(--muted)">${r.vehicle_type || '—'}</td>
              <td><span class="badge ${isReservation ? 'badge-reservation' : 'badge-walkin'}">${r.booking_type}</span></td>
              <td>${r.entry_time}</td>
              <td class="${isStill ? 'still' : 'exited'}">${exitCell}</td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

// ── Vehicle entry ────────────────────────────────────────────────────────────

async function assignSlot() {
  const vehicle  = document.getElementById('assign-vehicle').value.trim().toUpperCase();
  const select   = document.getElementById('assign-vtype');
  const vtId     = parseInt(select.dataset.autoVtId || select.value || 1);
  const msg      = document.getElementById('assign-msg');

  if (!vehicle)     { msg.textContent = 'Enter vehicle number.'; msg.className = 'msg err'; return; }
  if (!selectedSlot){ msg.textContent = 'Select a slot first.';  msg.className = 'msg err'; return; }

  const { ok, data } = await apiAssignSlot(vehicle, selectedSlot, vtId);
  msg.className = ok ? 'msg' : 'msg err';

  if (ok) {
    const isGuest = !!document.getElementById('modal-auth'); // auth modal only exists for guests
    msg.innerHTML = isGuest
      ? `${data.message} <span style="color:var(--muted)">— ⚠ Guest session: note your vehicle number (${vehicle}), anyone can release it.</span>`
      : data.message;
    document.getElementById('assign-vehicle').value = '';
    document.getElementById('assign-vtype-display').style.display = 'none';
    document.getElementById('assign-vtype').style.display = '';
    delete document.getElementById('assign-vtype').dataset.autoVtId;
    selectedSlot = null;
    document.getElementById('selected-slot-label').textContent = 'No slot selected';
    document.getElementById('assign-btn').disabled = true;
    loadSlots();
    loadRecords();
  } else {
    msg.textContent = data.error;
  }
}

// ── Vehicle Status + Exit ─────────────────────────────────────────────────────

let _vsTimerInterval = null;

function _vsPad(n) { return String(n).padStart(2, '0'); }

function _vsLiveDuration(entryIso) {
  const diff = Date.now() - new Date(entryIso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${_vsPad(h)}h ${_vsPad(m)}m ${_vsPad(s)}s`;
}

function _vsStartTimer(entryIso) {
  clearInterval(_vsTimerInterval);
  const el = document.getElementById('vs-duration');
  if (!el) return;
  el.textContent = _vsLiveDuration(entryIso);
  _vsTimerInterval = setInterval(() => {
    el.textContent = _vsLiveDuration(entryIso);
  }, 1000);
}

function _vsShowPlaceholder() {
  clearInterval(_vsTimerInterval);
  document.getElementById('vs-placeholder').style.display = 'flex';
  document.getElementById('vs-card').style.display        = 'none';
  document.getElementById('vs-release-btn').style.display = 'none';
}

async function fetchVehicleStatus() {
  const vehicle = document.getElementById('release-vehicle').value.trim().toUpperCase();
  const msg     = document.getElementById('release-msg');
  msg.textContent = ''; msg.className = 'msg';

  if (!vehicle) { msg.textContent = 'Enter a vehicle number.'; msg.className = 'msg err'; return; }

  // Look up the vehicle in the current records list
  const { ok, data: records } = await apiGetRecords();
  if (!ok) { msg.textContent = 'Could not load records.'; msg.className = 'msg err'; return; }

  const now = Date.now();

  // 1. Active walk-in or active reservation currently inside the lot
  const active = records.find(r => r.vehicle_number === vehicle && r.exit_time === 'Still parked');
  if (active) {
    // Overstay: reservation whose expected exit time has already passed
    const resExit = active.booking_type === 'Reservation' && active.res_exit_time
      ? new Date(active.res_exit_time).getTime()
      : null;
    const status = (resExit && now > resExit) ? 'overstay' : 'active';
    _vsShowRecord(active, status);
    return;
  }

  // 2. Future reservation — entry_time is in the future and exit_time is a real date
  const upcoming = records.find(r =>
    r.vehicle_number === vehicle &&
    r.booking_type === 'Reservation' &&
    r.exit_time !== 'Still parked' &&
    new Date(r.entry_time).getTime() > now
  );
  if (upcoming) {
    _vsShowRecord(upcoming, 'upcoming');
    return;
  }

  // 3. Active reservation — entry in past, exit in future (currently parked on reservation)
  const activeRes = records.find(r =>
    r.vehicle_number === vehicle &&
    r.booking_type === 'Reservation' &&
    r.exit_time !== 'Still parked' &&
    new Date(r.entry_time).getTime() <= now &&
    new Date(r.exit_time).getTime() > now
  );
  if (activeRes) {
    const resExit = new Date(activeRes.exit_time).getTime();
    const status  = now > resExit ? 'overstay' : 'active';
    _vsShowRecord(activeRes, status);
    return;
  }

  // 3. Released walk-in — booking_type is Walk-in (or Reservation that was checked in and exited)
  //    A pure Reservation row with a real exit_time is the reservation window, not a release event.
  const released = records.find(r =>
    r.vehicle_number === vehicle &&
    r.exit_time !== 'Still parked' &&
    r.booking_type !== 'Reservation'
  );
  if (released) {
    _vsShowRecord(released, 'released');
    return;
  }

  // 4. Past reservation (entry in the past, never physically checked in as walk-in)
  const pastRes = records.find(r =>
    r.vehicle_number === vehicle &&
    r.booking_type === 'Reservation'
  );
  if (pastRes) {
    _vsShowRecord(pastRes, 'upcoming');
    return;
  }

  _vsShowPlaceholder();
  msg.textContent = `No record found for ${vehicle}.`;
  msg.className = 'msg err';
}

function _vsShowRecord(record, status) {
  const placeholder  = document.getElementById('vs-placeholder');
  const card         = document.getElementById('vs-card');
  const releaseBtn   = document.getElementById('vs-release-btn');

  placeholder.style.display = 'none';

  // Animate re-render by briefly hiding
  card.style.display = 'none';
  void card.offsetWidth; // force reflow for animation replay
  card.style.display = 'block';

  document.getElementById('vs-number').textContent = record.vehicle_number;
  document.getElementById('vs-slot').textContent   = record.slot_number;
  document.getElementById('vs-type').textContent   = record.vehicle_type || '—';
  document.getElementById('vs-entry').textContent  = record.entry_time;

  const badge    = document.getElementById('vs-badge');
  const durEl    = document.getElementById('vs-duration');

  if (status === 'active') {
    badge.textContent = 'Active';
    badge.className   = 'badge badge-walkin';
    badge.style.cssText = 'color:var(--green);border-color:var(--green);background:rgba(0,255,157,0.07)';
    durEl.style.color = 'var(--green)';
    durEl.previousElementSibling.textContent = 'Duration';
    _vsStartTimer(record.entry_time);
    releaseBtn.style.display = record.booking_type === 'Reservation' ? 'none' : 'block';
  } else if (status === 'overstay') {
    badge.textContent = 'Overstay';
    badge.className   = 'badge';
    badge.style.cssText = 'color:#ca8a04;border-color:#ca8a04;background:rgba(234,179,8,0.08)';
    durEl.style.color = '#ca8a04';
    durEl.previousElementSibling.textContent = 'Duration';
    _vsStartTimer(record.entry_time);
    releaseBtn.style.display = 'block';
  } else if (status === 'upcoming') {
    badge.textContent = 'Reserved';
    badge.className   = 'badge';
    badge.style.cssText = 'color:#7059a6;border-color:#9b87c4;background:rgba(110,85,170,0.07)';
    clearInterval(_vsTimerInterval);
    durEl.style.color = '#7059a6';
    durEl.textContent = record.exit_time || '—';
    durEl.previousElementSibling.textContent = 'Reserved Until';
    releaseBtn.style.display = 'none';
  } else {
    badge.textContent = 'Released';
    badge.className   = 'badge';
    badge.style.cssText = 'color:var(--muted);border-color:var(--border);background:transparent';
    clearInterval(_vsTimerInterval);
    durEl.style.color   = 'var(--muted)';
    durEl.textContent   = record.exit_time || '—';
    durEl.previousElementSibling.textContent = 'Exit Time';
    releaseBtn.style.display = 'none';
  }
}

async function releaseSlot() {
  const vehicle = document.getElementById('release-vehicle').value.trim().toUpperCase();
  const msg     = document.getElementById('release-msg');

  if (!vehicle) { msg.textContent = 'Enter vehicle number.'; msg.className = 'msg err'; return; }

  const { ok, data } = await apiReleaseSlot(vehicle);
  msg.textContent = data.message || data.error;
  msg.className   = ok ? 'msg' : 'msg err';

  if (ok) {
    clearInterval(_vsTimerInterval);
    _vsShowPlaceholder();
    document.getElementById('release-vehicle').value = '';
    loadSlots();
    loadRecords();
  }
}

// ── Auth / Owner nav ─────────────────────────────────────────────────────────

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(id) {
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.getElementById(id).classList.remove('open');
}

// ── Nav bootstrap ─────────────────────────────────────────────────────────────

async function loadOwnerNav() {
  const res  = await fetch('/auth/me');
  const data = await res.json();
  if (!data.logged_in) { window.location.href = '/login.html'; return; }

  const header = document.querySelector('header');

  if (data.guest) {
    // Guest: show a simple badge + "Login / Register" that opens a modal
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-left:auto; display:flex; align-items:center; gap:0.75rem;';
    wrap.innerHTML = `
      <span style="font-family:'Share Tech Mono',monospace; font-size:0.72rem; color:var(--muted);
                   border:1px solid var(--border); padding:0.3rem 0.7rem; border-radius:3px;">
        Guest session
      </span>
      <button onclick="openAuthModal()" style="background:transparent; border:1px solid var(--border);
        color:var(--muted); font-size:0.75rem; padding:0.3rem 0.8rem; font-family:'Share Tech Mono',monospace;
        font-weight:400; border-radius:3px;">
        Login / Register
      </button>
    `;
    header.appendChild(wrap);

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'modal-backdrop';
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', closeAllModals);
    document.body.appendChild(backdrop);

    // Auth modal (login + register tabs)
    const authModal = document.createElement('div');
    authModal.id = 'modal-auth';
    authModal.className = 'modal';
    authModal.innerHTML = `
      <div class="modal-header">
        <span class="modal-title">// Login or Register</span>
        <button class="modal-close" onclick="closeModal('modal-auth')">✕</button>
      </div>
      <div class="modal-body" style="padding:0; gap:0;">
        <div style="display:flex; border-bottom:1px solid var(--border);">
          <button id="auth-tab-login"    onclick="switchAuthTab('login')"
            style="flex:1; padding:0.85rem; background:none; border:none; border-radius:0;
                   font-family:'Share Tech Mono',monospace; font-size:0.78rem; letter-spacing:0.1em;
                   text-transform:uppercase; cursor:pointer; color:var(--accent);
                   border-bottom:2px solid var(--accent); margin-bottom:-1px; opacity:1;">Login</button>
          <button id="auth-tab-register" onclick="switchAuthTab('register')"
            style="flex:1; padding:0.85rem; background:none; border:none; border-radius:0;
                   font-family:'Share Tech Mono',monospace; font-size:0.78rem; letter-spacing:0.1em;
                   text-transform:uppercase; cursor:pointer; color:var(--muted); opacity:1;">Register</button>
        </div>

        <!-- Login panel -->
        <div id="auth-panel-login" style="display:flex; flex-direction:column; gap:0.9rem; padding:1.4rem;">
          <div class="field-group">
            <label class="select-label">Email or Phone</label>
            <input type="text" id="al-id" placeholder="you@example.com or 9876543210" autocomplete="username"/>
          </div>
          <div class="field-group">
            <label class="select-label">Password</label>
            <input type="password" id="al-pw" placeholder="••••••••" autocomplete="current-password"
                   onkeydown="if(event.key==='Enter') doAuthLogin()"/>
          </div>
          <button onclick="doAuthLogin()">Login →</button>
          <div class="msg" id="al-msg"></div>
        </div>

        <!-- Register panel -->
        <div id="auth-panel-register" style="display:none; flex-direction:column; gap:0.9rem; padding:1.4rem;">
          <div class="field-group">
            <label class="select-label">Full Name</label>
            <input type="text" id="ar-name" placeholder="Jane Doe"/>
          </div>
          <div class="field-group">
            <label class="select-label">Email <span style="opacity:.5">(optional if phone given)</span></label>
            <input type="email" id="ar-email" placeholder="you@example.com" autocomplete="email"/>
          </div>
          <div class="field-group">
            <label class="select-label">Phone <span style="opacity:.5">(optional if email given)</span></label>
            <input type="tel" id="ar-phone" placeholder="9876543210"/>
          </div>
          <div class="field-group">
            <label class="select-label">Password</label>
            <input type="password" id="ar-pw" placeholder="min 6 characters" autocomplete="new-password"
                   onkeydown="if(event.key==='Enter') doAuthRegister()"/>
          </div>
          <button onclick="doAuthRegister()">Create Account →</button>
          <div class="msg" id="ar-msg"></div>
        </div>
      </div>
    `;
    document.body.appendChild(authModal);

    // Persistent warning banner in the entry card
    const entryCard = document.querySelector('.card:not(.slots-card):not(.accent2):not(.reservation-card):not(.records-card)');
    if (entryCard) {
      const banner = document.createElement('div');
      banner.style.cssText = `
        margin-bottom: 0.75rem;
        padding: 0.55rem 0.85rem;
        border: 1px solid #ca8a04;
        border-radius: 3px;
        background: rgba(202,138,4,0.08);
        font-family: 'Share Tech Mono', monospace;
        font-size: 0.72rem;
        color: #ca8a04;
        letter-spacing: 0.03em;
        line-height: 1.5;
      `;
      banner.style.whiteSpace = 'pre-line';
      banner.textContent ='⚠ Guest session — records are not tied to your account.\nNote: Someone can release your vehicle anonymously.';
      entryCard.insertBefore(banner, entryCard.querySelector('h2').nextSibling);
    }
    return;
  }
  const initials = data.owner_name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();

  // Dropdown trigger
  const wrap = document.createElement('div');
  wrap.className = 'profile-dropdown-wrap';
  wrap.innerHTML = `
    <button class="profile-btn" id="profile-trigger">
      <div class="avatar">${initials}</div>
      ${data.owner_name} <span class="pd-arrow">▾</span>
    </button>
    <div class="profile-dropdown" id="profile-dropdown">
      <button class="pd-item" onclick="openProfileModal()">⛶&nbsp; My Profile</button>
      <button class="pd-item" onclick="openVehiclesModal()">⛟&nbsp; My Vehicles</button>
      <div class="pd-divider"></div>
      <button class="pd-item pd-item-logout" onclick="doLogout()">⏻&nbsp; Logout</button>
    </div>
  `;
  header.appendChild(wrap);

  document.getElementById('profile-trigger').addEventListener('click', e => {
    e.stopPropagation();
    const dd = document.getElementById('profile-dropdown');
    dd.classList.toggle('open');
    document.querySelector('.pd-arrow').textContent = dd.classList.contains('open') ? '▴' : '▾';
  });
  document.addEventListener('click', () => {
    document.getElementById('profile-dropdown')?.classList.remove('open');
    const arr = document.querySelector('.pd-arrow');
    if (arr) arr.textContent = '▾';
  });
  document.getElementById('profile-dropdown').addEventListener('click', e => e.stopPropagation());

  // Inject modals + backdrop into body
  const backdrop = document.createElement('div');
  backdrop.id = 'modal-backdrop';
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', closeAllModals);
  document.body.appendChild(backdrop);

  // Profile modal
  const profileModal = document.createElement('div');
  profileModal.id = 'modal-profile';
  profileModal.className = 'modal';
  profileModal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">// My Profile</span>
      <button class="modal-close" onclick="closeModal('modal-profile')">✕</button>
    </div>
    <div class="modal-body">
      <div class="field-group">
        <label class="select-label">Full Name</label>
        <input type="text" id="p-name" placeholder="Jane Doe"/>
      </div>
      <div class="field-group">
        <label class="select-label">Email</label>
        <input type="email" id="p-email" placeholder="you@example.com"/>
      </div>
      <div class="field-group">
        <label class="select-label">Phone</label>
        <input type="tel" id="p-phone" placeholder="9876543210"/>
      </div>
      <div style="border-top:1px solid var(--border);padding-top:0.9rem;display:flex;flex-direction:column;gap:0.6rem;">
        <label class="select-label">Change Password <span style="opacity:0.5;text-transform:none;letter-spacing:0">(leave blank to keep)</span></label>
        <input type="password" id="p-pw-old" placeholder="Current password"/>
        <input type="password" id="p-pw"     placeholder="New password (min 6 chars)"/>
        <input type="password" id="p-pw2"    placeholder="Confirm new password"/>
      </div>
      <button onclick="saveProfile()" style="align-self:flex-start;">Save Changes</button>
      <div class="msg" id="p-msg"></div>
    </div>
  `;
  document.body.appendChild(profileModal);

  // Vehicles modal
  const vehiclesModal = document.createElement('div');
  vehiclesModal.id = 'modal-vehicles';
  vehiclesModal.className = 'modal';
  vehiclesModal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">// My Vehicles</span>
      <button class="modal-close" onclick="closeModal('modal-vehicles')">✕</button>
    </div>
    <div class="modal-body">
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:0.6rem;align-items:flex-end;">
        <div class="field-group">
          <label class="select-label">Vehicle Number</label>
          <input type="text" id="mv-number" placeholder="KA01AB1234"/>
        </div>
        <div class="field-group">
          <label class="select-label">Vehicle Type</label>
          <select id="mv-vtype" class="vtype-select">
            <option value="" disabled selected>Choose type</option>
          </select>
        </div>
        <div class="field-group">
          <label class="select-label" style="visibility:hidden">Add</label>
          <button onclick="addVehicle()" style="margin:0;">+ Add</button>
        </div>
      </div>
      <div class="msg" id="mv-msg"></div>
      <div id="mv-list"></div>
    </div>
  `;
  document.body.appendChild(vehiclesModal);

  // Load profile data into modal
  const pr = await fetch('/owner/profile');
  const pd = await pr.json();
  document.getElementById('p-name').value  = pd.owner_name   || '';
  document.getElementById('p-email').value = pd.email        || '';
  document.getElementById('p-phone').value = pd.phone_number || '';

  loadMyVehicles();

  // Logged-in owners: vehicle type is always known from registration.
  // Hide the manual dropdowns permanently — lookupVehicleType() will show
  // the locked display instead whenever a vehicle number is typed.
  document.getElementById('assign-vtype').style.display = 'none';
  document.getElementById('res-vtype').style.display    = 'none';
  // Show placeholder text in the locked displays until a vehicle is typed
  document.getElementById('assign-vtype-display').style.display = 'flex';
  document.getElementById('assign-vtype-label').textContent     = '— type a vehicle number';
  document.getElementById('res-vtype-display').style.display    = 'flex';
  document.getElementById('res-vtype-label').textContent        = '— type a vehicle number';
  // Style placeholders as muted
  document.getElementById('assign-vtype-display').style.borderColor = 'var(--border)';
  document.getElementById('assign-vtype-display').style.color       = 'var(--muted)';
  document.getElementById('res-vtype-display').style.borderColor    = 'var(--border)';
  document.getElementById('res-vtype-display').style.color          = 'var(--muted)';
}

function closeAllModals() {
  document.getElementById('modal-backdrop').classList.remove('open');
  document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
}

function openProfileModal() {
  closeAllModals();
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('modal-profile').classList.add('open');
}

function openVehiclesModal() {
  closeAllModals();
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('modal-vehicles').classList.add('open');
}

async function doLogout() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ── Profile modal logic ───────────────────────────────────────────────────────

async function saveProfile() {
  const msg    = document.getElementById('p-msg');
  const pwOld  = document.getElementById('p-pw-old').value;
  const pw     = document.getElementById('p-pw').value;
  const pw2    = document.getElementById('p-pw2').value;

  if (pw || pwOld) {
    if (!pwOld)           { msg.textContent = 'Enter your current password.';         msg.className = 'msg err'; return; }
    if (!pw)              { msg.textContent = 'Enter a new password.';                msg.className = 'msg err'; return; }
    if (pw.length < 6)    { msg.textContent = 'New password must be at least 6 characters.'; msg.className = 'msg err'; return; }
    if (pw !== pw2)       { msg.textContent = 'Passwords do not match.';              msg.className = 'msg err'; return; }
  }

  const body = {
    owner_name:   document.getElementById('p-name').value.trim(),
    email:        document.getElementById('p-email').value.trim(),
    phone_number: document.getElementById('p-phone').value.trim(),
  };
  if (pw) { body.old_password = pwOld; body.password = pw; }

  const res  = await fetch('/owner/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  msg.textContent = data.message || data.error;
  msg.className   = res.ok ? 'msg' : 'msg err';
  if (res.ok) {
    document.getElementById('p-pw-old').value = '';
    document.getElementById('p-pw').value     = '';
    document.getElementById('p-pw2').value    = '';
  }
}

// ── Vehicles modal logic ──────────────────────────────────────────────────────

async function loadMyVehicles() {
  const res  = await fetch('/owner/vehicles');
  const data = await res.json();
  _myVehicles = data;   // cache for entry-form auto-lookup
  const list = document.getElementById('mv-list');

  const vtSel = document.getElementById('assign-vtype');
  const mvSel = document.getElementById('mv-vtype');
  if (mvSel && vtSel) mvSel.innerHTML = vtSel.innerHTML;

  if (!data.length) {
    list.innerHTML = '<div class="empty" style="padding:1rem 0 0;">No vehicles registered yet.</div>';
    return;
  }

  list.innerHTML = `
    <table>
      <thead><tr><th>Vehicle Number</th><th>Type</th><th>Rate</th><th></th></tr></thead>
      <tbody>
        ${data.map(v => `
          <tr>
            <td style="font-weight:bold;">${v.vehicle_number}</td>
            <td style="color:var(--muted)">${v.type_name}</td>
            <td style="color:#7c3aed">$${v.hourly_rate.toFixed(2)}/hr</td>
            <td><button class="danger" onclick="removeVehicle('${v.vehicle_number}')"
              style="font-size:0.7rem;padding:0.25rem 0.6rem;">✕</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function addVehicle() {
  const number = document.getElementById('mv-number').value.trim().toUpperCase();
  const vtId   = document.getElementById('mv-vtype').value;
  const msg    = document.getElementById('mv-msg');

  if (!number) { msg.textContent = 'Enter vehicle number.'; msg.className = 'msg err'; return; }
  if (!vtId)   { msg.textContent = 'Select vehicle type.';  msg.className = 'msg err'; return; }

  const res  = await fetch('/owner/vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vehicle_number: number, vehicle_type_id: parseInt(vtId) }),
  });
  const d = await res.json();
  msg.textContent = d.message || d.error;
  msg.className   = res.ok ? 'msg' : 'msg err';
  if (res.ok) { document.getElementById('mv-number').value = ''; loadMyVehicles(); }
}

async function removeVehicle(vehicleNumber) {
  const msg = document.getElementById('mv-msg');
  const res = await fetch(`/owner/vehicles/${vehicleNumber}`, { method: 'DELETE' });
  const d   = await res.json();
  msg.textContent = d.message || d.error;
  msg.className   = res.ok ? 'msg' : 'msg err';
  if (res.ok) loadMyVehicles();
}

// ── Guest auth modal ──────────────────────────────────────────────────────────

function openAuthModal() {
  document.getElementById('modal-backdrop').classList.add('open');
  document.getElementById('modal-auth').classList.add('open');
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  const tLogin  = document.getElementById('auth-tab-login');
  const tReg    = document.getElementById('auth-tab-register');
  const pLogin  = document.getElementById('auth-panel-login');
  const pReg    = document.getElementById('auth-panel-register');

  tLogin.style.color       = isLogin ? 'var(--accent)' : 'var(--muted)';
  tLogin.style.borderBottom= isLogin ? '2px solid var(--accent)' : 'none';
  tReg.style.color         = isLogin ? 'var(--muted)' : 'var(--accent)';
  tReg.style.borderBottom  = isLogin ? 'none' : '2px solid var(--accent)';

  pLogin.style.display = isLogin ? 'flex' : 'none';
  pReg.style.display   = isLogin ? 'none' : 'flex';
}

async function doAuthLogin() {
  const msg = document.getElementById('al-msg');
  msg.className = 'msg'; msg.textContent = 'Logging in…';
  const res  = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: document.getElementById('al-id').value.trim(),
      password:   document.getElementById('al-pw').value,
    }),
  });
  const data = await res.json();
  if (res.ok) {
    msg.textContent = data.message;
    setTimeout(() => window.location.reload(), 500);
  } else {
    msg.className = 'msg err'; msg.textContent = data.error;
  }
}

async function doAuthRegister() {
  const msg = document.getElementById('ar-msg');
  msg.className = 'msg'; msg.textContent = 'Creating account…';
  const res  = await fetch('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_name:   document.getElementById('ar-name').value.trim(),
      email:        document.getElementById('ar-email').value.trim(),
      phone_number: document.getElementById('ar-phone').value.trim(),
      password:     document.getElementById('ar-pw').value,
    }),
  });
  const data = await res.json();
  if (res.ok) {
    msg.textContent = data.message;
    setTimeout(() => window.location.reload(), 500);
  } else {
    msg.className = 'msg err'; msg.textContent = data.error;
  }
}

// ── System Status panel ───────────────────────────────────────────────────────

function updateSysStatus(slots) {
  const total = slots.length;
  const occ   = slots.filter(s => s.is_occupied).length;
  const res   = slots.filter(s => !s.is_occupied && (s.is_reserved || s.next_res_start)).length;
  const free  = total - occ - res;
  const evFree  = slots.filter(s => s.slot_type === 'EV'          && !s.is_occupied && !s.is_reserved && !s.next_res_start).length;
  const hcFree  = slots.filter(s => s.slot_type === 'Handicapped' && !s.is_occupied && !s.is_reserved && !s.next_res_start).length;

  document.getElementById('ss-total').textContent = total;
  document.getElementById('ss-free').textContent  = free;
  document.getElementById('ss-occ').textContent   = occ;
  document.getElementById('ss-res').textContent   = res;
  document.getElementById('ss-ev').textContent    = evFree;
  document.getElementById('ss-hc').textContent    = hcFree;
}

// Clock — ticks every second
function tickClock() {
  const el = document.getElementById('ss-clock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.toTimeString().slice(0, 8);
}
setInterval(tickClock, 1000);
tickClock();

// ── Bootstrap ────────────────────────────────────────────────────────────────

loadOwnerNav();
loadVehicleTypes();
loadSlots();
loadRecords();

// Auto-refresh slots every 30s so the backend can release walk-ins when reservations start.
setInterval(loadSlots, 30_000);