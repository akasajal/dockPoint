from flask import Flask, request, jsonify, session, render_template, redirect, url_for
import mysql.connector
from datetime import datetime
import math
import bcrypt
import re
import os
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY")

DB_CONFIG = {
    'host': os.getenv("DB_HOST"),
    'user': os.getenv("DB_USER"),
    'password': os.getenv("DB_PASSWORD"),
    'database': os.getenv("DB_NAME")
}

def get_db():
    conn = mysql.connector.connect(**DB_CONFIG)
    return conn

# ── Pricing ───────────────────────────────────────────────────────────────────

DEFAULT_RATE_PER_HOUR = 2.0

def calc_amount(entry_time, exit_time, rate_per_hour=None):
    if rate_per_hour is None:
        rate_per_hour = DEFAULT_RATE_PER_HOUR
    delta_minutes = (exit_time - entry_time).total_seconds() / 60
    if delta_minutes <= 0:
        return 0.0
    hours = math.ceil(delta_minutes / 60)
    return round(hours * rate_per_hour, 2)

# ── Auth helpers ──────────────────────────────────────────────────────────────

def current_owner_id():
    return session.get('owner_id')

def is_guest():
    return session.get('guest') is True

def login_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_owner_id():
            return jsonify({'error': 'Login required.'}), 401
        return f(*args, **kwargs)
    return decorated

def parking_required(f):
    """Allows both logged-in owners and guests. Guests skip ownership checks."""
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_owner_id() and not is_guest():
            return jsonify({'error': 'Login required.'}), 401
        return f(*args, **kwargs)
    return decorated

# ── DB Init ───────────────────────────────────────────────────────────────────

def init_db():
    conn = get_db()
    c = conn.cursor()

    # vehicle_types
    c.execute('''
        CREATE TABLE IF NOT EXISTS vehicle_types (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            type_name   VARCHAR(20) UNIQUE NOT NULL,
            hourly_rate DECIMAL(10,2) NOT NULL
        )
    ''')
    c.execute("""
        INSERT IGNORE INTO vehicle_types (type_name, hourly_rate) VALUES
            ('Bicycle',     1.00),
            ('Motorcycle',  2.00),
            ('Car',         3.00),
            ('Van',         3.00),
            ('Truck',       4.00),
            ('Bus',         4.00)
    """)

    # slot_types
    c.execute('''
        CREATE TABLE IF NOT EXISTS slot_types (
            id   INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(20) UNIQUE NOT NULL
        )
    ''')
    c.execute("INSERT IGNORE INTO slot_types (name) VALUES ('Regular'), ('EV'), ('Handicapped')")

    # slots
    c.execute('''
        CREATE TABLE IF NOT EXISTS slots (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            slot_number  VARCHAR(10) UNIQUE NOT NULL,
            is_occupied  TINYINT(1) DEFAULT 0,
            slot_type_id INT NOT NULL DEFAULT 1,
            CONSTRAINT fk_slot_type FOREIGN KEY (slot_type_id)
                REFERENCES slot_types(id) ON UPDATE CASCADE ON DELETE RESTRICT
        )
    ''')

    # owners  (password_hash added)
    c.execute('''
        CREATE TABLE IF NOT EXISTS owners (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            owner_name    VARCHAR(100) NOT NULL,
            phone_number  VARCHAR(15)  UNIQUE,
            email         VARCHAR(100) UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # vehicles
    c.execute('''
        CREATE TABLE IF NOT EXISTS vehicles (
            vehicle_number   VARCHAR(20) PRIMARY KEY,
            owner_id         INT NOT NULL,
            vehicle_type_id  INT NOT NULL,
            CONSTRAINT fk_vehicle_owner FOREIGN KEY (owner_id)
                REFERENCES owners(id) ON DELETE CASCADE,
            CONSTRAINT fk_vehicle_type  FOREIGN KEY (vehicle_type_id)
                REFERENCES vehicle_types(id) ON DELETE RESTRICT
        )
    ''')

    # records
    c.execute('''
        CREATE TABLE IF NOT EXISTS records (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            vehicle_number   VARCHAR(20) NOT NULL,
            slot_number      VARCHAR(10) NOT NULL,
            vehicle_type_id  INT NOT NULL DEFAULT 1,
            entry_time       DATETIME NOT NULL,
            exit_time        DATETIME,
            amount           DECIMAL(10,2) DEFAULT NULL,
            active_vehicle   VARCHAR(20) GENERATED ALWAYS AS (IF(exit_time IS NULL, vehicle_number, NULL)) STORED,
            active_slot      VARCHAR(10)  GENERATED ALWAYS AS (IF(exit_time IS NULL, slot_number,   NULL)) STORED,
            UNIQUE INDEX uq_one_active_per_vehicle (active_vehicle),
            UNIQUE INDEX uq_one_active_per_slot    (active_slot),
            CONSTRAINT fk_rec_vtype FOREIGN KEY (vehicle_type_id)
                REFERENCES vehicle_types(id) ON UPDATE CASCADE ON DELETE RESTRICT
        )
    ''')

    # reservations
    c.execute('''
        CREATE TABLE IF NOT EXISTS reservations (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            vehicle_number   VARCHAR(20) NOT NULL,
            slot_number      VARCHAR(10) NOT NULL,
            vehicle_type_id  INT NOT NULL DEFAULT 1,
            entry_time       DATETIME NOT NULL,
            exit_time        DATETIME NOT NULL,
            amount           DECIMAL(10,2) NOT NULL,
            created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_res_slot    FOREIGN KEY (slot_number)
                REFERENCES slots(slot_number)       ON UPDATE CASCADE ON DELETE RESTRICT,
            CONSTRAINT fk_res_vtype   FOREIGN KEY (vehicle_type_id)
                REFERENCES vehicle_types(id)        ON UPDATE CASCADE ON DELETE RESTRICT,
            CONSTRAINT fk_res_vehicle FOREIGN KEY (vehicle_number)
                REFERENCES vehicles(vehicle_number) ON DELETE CASCADE
        )
    ''')

    # Triggers
    c.execute('DROP TRIGGER IF EXISTS after_insert_record')
    c.execute('''
        CREATE TRIGGER after_insert_record
        AFTER INSERT ON records FOR EACH ROW
        BEGIN
            UPDATE slots SET is_occupied = 1 WHERE slot_number = NEW.slot_number;
        END
    ''')

    c.execute('DROP TRIGGER IF EXISTS after_update_record')
    c.execute('''
        CREATE TRIGGER after_update_record
        AFTER UPDATE ON records FOR EACH ROW
        BEGIN
            IF NEW.exit_time IS NOT NULL THEN
                UPDATE slots SET is_occupied = 0 WHERE slot_number = NEW.slot_number;
            END IF;
        END
    ''')

    c.execute('DROP TRIGGER IF EXISTS after_delete_record')
    c.execute('''
        CREATE TRIGGER after_delete_record
        AFTER DELETE ON records FOR EACH ROW
        BEGIN
            UPDATE slots SET is_occupied = 0 WHERE slot_number = OLD.slot_number;
        END
    ''')

    # Seed slots
    c.execute('SELECT COUNT(*) FROM slots')
    if c.fetchone()[0] == 0:
        slots = []
        for row in 'ABCD':
            for col in range(1, 17):
                slots.append((f'{row}{col}',))
        for row in 'EFG':
            for col in range(1, 21):
                slots.append((f'{row}{col}',))
        c.executemany('INSERT INTO slots (slot_number) VALUES (%s)', slots)

    c.execute("SELECT id FROM slot_types WHERE name='Handicapped'")
    handicapped_id = c.fetchone()[0]
    c.execute("SELECT id FROM slot_types WHERE name='EV'")
    ev_id = c.fetchone()[0]
    c.execute("SELECT id FROM slot_types WHERE name='Regular'")
    regular_id = c.fetchone()[0]

    handicapped = ['A1','B1','C1','D1','E1','F1','G1','A16','B16','C16','D16','E20','F20','G20']
    ev          = ['A5','A6','A7','A8','A9','A10','A11','A12','B5','B6','B7','B8','B9','B10','B11','B12']

    for s in handicapped:
        c.execute("UPDATE slots SET slot_type_id=%s WHERE slot_number=%s AND slot_type_id=%s",
                  (handicapped_id, s, regular_id))
    for s in ev:
        c.execute("UPDATE slots SET slot_type_id=%s WHERE slot_number=%s AND slot_type_id=%s",
                  (ev_id, s, regular_id))

    conn.commit()
    c.close()
    conn.close()

# ── Static ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    if not current_owner_id() and not is_guest():
        return redirect(url_for('login_page'))
    return render_template('index.html')

@app.route('/login.html')
def login_page():
    return render_template('login.html')

@app.route('/profile.html')
def profile_page():
    if not current_owner_id():
        return redirect(url_for('login_page'))
    return render_template('profile.html')

@app.route('/vehicles.html')
def vehicles_page():
    if not current_owner_id():
        return redirect(url_for('login_page'))
    return render_template('vehicles.html')

# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.route('/auth/register', methods=['POST'])
def register():
    data     = request.get_json()
    name     = (data.get('owner_name') or '').strip()
    email    = (data.get('email') or '').strip().lower() or None
    phone    = (data.get('phone_number') or '').strip() or None
    password = (data.get('password') or '')

    if not name:
        return jsonify({'error': 'Name is required.'}), 400
    if not email and not phone:
        return jsonify({'error': 'Provide at least an email or phone number.'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters.'}), 400
    if email and not re.match(r'^[^@]+@[^@]+\.[^@]+$', email):
        return jsonify({'error': 'Invalid email address.'}), 400

    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    conn = get_db()
    c = conn.cursor()
    try:
        c.execute('''
            INSERT INTO owners (owner_name, email, phone_number, password_hash)
            VALUES (%s, %s, %s, %s)
        ''', (name, email, phone, pw_hash))
        conn.commit()
        owner_id = c.lastrowid
        session.pop('guest', None)
        session['owner_id']   = owner_id
        session['owner_name'] = name
        return jsonify({'message': f'Welcome, {name}!', 'owner_name': name}), 201
    except mysql.connector.IntegrityError as e:
        conn.rollback()
        msg = str(e)
        if 'email' in msg:
            return jsonify({'error': 'Email already registered.'}), 409
        if 'phone' in msg:
            return jsonify({'error': 'Phone number already registered.'}), 409
        return jsonify({'error': 'Registration failed.'}), 400
    finally:
        c.close(); conn.close()


@app.route('/auth/login', methods=['POST'])
def login():
    data       = request.get_json()
    identifier = (data.get('identifier') or '').strip().lower()
    password   = (data.get('password') or '')

    if not identifier or not password:
        return jsonify({'error': 'Credentials required.'}), 400

    conn = get_db()
    c = conn.cursor(dictionary=True)
    try:
        c.execute('''
            SELECT id, owner_name, password_hash
            FROM owners
            WHERE email = %s OR phone_number = %s
            LIMIT 1
        ''', (identifier, identifier))
        owner = c.fetchone()
    finally:
        c.close(); conn.close()

    if not owner or not bcrypt.checkpw(password.encode(), owner['password_hash'].encode()):
        return jsonify({'error': 'Invalid credentials.'}), 401

    session.pop('guest', None)
    session['owner_id']   = owner['id']
    session['owner_name'] = owner['owner_name']
    return jsonify({'message': f'Welcome back, {owner["owner_name"]}!', 'owner_name': owner['owner_name']})


@app.route('/auth/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': 'Logged out.'})


@app.route('/auth/guest', methods=['POST'])
def guest_login():
    session.clear()
    session['guest'] = True
    return jsonify({'message': 'Continuing as guest.'})


@app.route('/auth/me', methods=['GET'])
def me():
    if is_guest():
        return jsonify({'logged_in': True, 'guest': True, 'owner_name': 'Guest'})
    if not current_owner_id():
        return jsonify({'logged_in': False}), 200
    return jsonify({
        'logged_in':  True,
        'guest':      False,
        'owner_id':   session['owner_id'],
        'owner_name': session['owner_name'],
    })

# ── Owner: profile ───────────────────────────────────────────────────────────

@app.route('/owner/profile', methods=['GET'])
@login_required
def owner_get_profile():
    conn = get_db()
    c = conn.cursor(dictionary=True)
    c.execute('SELECT owner_name, email, phone_number FROM owners WHERE id = %s', (current_owner_id(),))
    row = c.fetchone()
    c.close(); conn.close()
    return jsonify(row)


@app.route('/owner/profile', methods=['PUT'])
@login_required
def owner_update_profile():
    data     = request.get_json()
    name     = (data.get('owner_name') or '').strip()
    email    = (data.get('email') or '').strip().lower() or None
    phone    = (data.get('phone_number') or '').strip() or None
    password = data.get('password')

    if not name:
        return jsonify({'error': 'Name is required.'}), 400
    if not email and not phone:
        return jsonify({'error': 'Provide at least an email or phone number.'}), 400
    if email and not re.match(r'^[^@]+@[^@]+\.[^@]+$', email):
        return jsonify({'error': 'Invalid email address.'}), 400

    conn = get_db()
    c = conn.cursor()
    try:
        if password:
            old_password = data.get('old_password') or ''
            # Verify old password first
            c.execute('SELECT password_hash FROM owners WHERE id = %s', (current_owner_id(),))
            row = c.fetchone()
            if not row or not bcrypt.checkpw(old_password.encode(), row[0].encode()):
                return jsonify({'error': 'Current password is incorrect.'}), 403
            pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            c.execute('''UPDATE owners SET owner_name=%s, email=%s, phone_number=%s, password_hash=%s WHERE id=%s''',
                      (name, email, phone, pw_hash, current_owner_id()))
        else:
            c.execute('''UPDATE owners SET owner_name=%s, email=%s, phone_number=%s WHERE id=%s''',
                      (name, email, phone, current_owner_id()))
        conn.commit()
        session['owner_name'] = name
        return jsonify({'message': 'Profile updated.'})
    except mysql.connector.IntegrityError as e:
        conn.rollback()
        msg = str(e)
        if 'email' in msg:
            return jsonify({'error': 'Email already in use.'}), 409
        if 'phone' in msg:
            return jsonify({'error': 'Phone already in use.'}), 409
        return jsonify({'error': 'Update failed.'}), 400
    finally:
        c.close(); conn.close()


# ── Owner: vehicle management ─────────────────────────────────────────────────

@app.route('/owner/vehicles', methods=['GET'])
@login_required
def owner_get_vehicles():
    conn = get_db()
    c = conn.cursor(dictionary=True)
    c.execute('''
        SELECT v.vehicle_number, v.vehicle_type_id, vt.type_name, vt.hourly_rate
        FROM vehicles v
        JOIN vehicle_types vt ON vt.id = v.vehicle_type_id
        WHERE v.owner_id = %s
        ORDER BY v.vehicle_number
    ''', (current_owner_id(),))
    rows = c.fetchall()
    c.close(); conn.close()
    for r in rows:
        r['hourly_rate'] = float(r['hourly_rate'])
    return jsonify(rows)


@app.route('/owner/vehicles', methods=['POST'])
@login_required
def owner_add_vehicle():
    data            = request.get_json()
    vehicle_number  = (data.get('vehicle_number') or '').strip().upper()
    vehicle_type_id = int(data.get('vehicle_type_id') or 0)

    if not vehicle_number:
        return jsonify({'error': 'Vehicle number required.'}), 400
    if not vehicle_type_id:
        return jsonify({'error': 'Vehicle type required.'}), 400

    conn = get_db()
    c = conn.cursor()
    try:
        c.execute('SELECT id FROM vehicle_types WHERE id = %s', (vehicle_type_id,))
        if not c.fetchone():
            return jsonify({'error': 'Invalid vehicle type.'}), 400

        c.execute('''
            INSERT INTO vehicles (vehicle_number, owner_id, vehicle_type_id)
            VALUES (%s, %s, %s)
        ''', (vehicle_number, current_owner_id(), vehicle_type_id))
        conn.commit()
        return jsonify({'message': f'{vehicle_number} registered.'}), 201
    except mysql.connector.IntegrityError:
        conn.rollback()
        return jsonify({'error': f'{vehicle_number} is already registered.'}), 409
    finally:
        c.close(); conn.close()


@app.route('/owner/vehicles/<vehicle_number>', methods=['DELETE'])
@login_required
def owner_delete_vehicle(vehicle_number):
    vehicle_number = vehicle_number.upper()
    conn = get_db()
    c = conn.cursor()
    try:
        c.execute('SELECT owner_id FROM vehicles WHERE vehicle_number = %s', (vehicle_number,))
        row = c.fetchone()
        if not row:
            return jsonify({'error': 'Vehicle not found.'}), 404
        if row[0] != current_owner_id():
            return jsonify({'error': 'Not your vehicle.'}), 403

        c.execute('DELETE FROM vehicles WHERE vehicle_number = %s', (vehicle_number,))
        conn.commit()
        return jsonify({'message': f'{vehicle_number} removed.'})
    except mysql.connector.IntegrityError:
        conn.rollback()
        return jsonify({'error': 'Cannot remove: vehicle has active parking records.'}), 409
    finally:
        c.close(); conn.close()

# ── Owner: personal records & reservations ────────────────────────────────────

@app.route('/owner/records', methods=['GET'])
@login_required
def owner_records():
    conn = get_db()
    c = conn.cursor(dictionary=True)
    c.execute('''
        SELECT r.id, r.vehicle_number, r.slot_number,
               vt.type_name AS vehicle_type,
               r.entry_time, r.exit_time, r.amount,
               'Walk-in' AS booking_type
        FROM records r
        JOIN vehicle_types vt ON vt.id = r.vehicle_type_id
        JOIN vehicles v       ON v.vehicle_number = r.vehicle_number
        WHERE v.owner_id = %s
        ORDER BY r.id DESC
    ''', (current_owner_id(),))
    records = c.fetchall()

    c.execute('''
        SELECT rs.id, rs.vehicle_number, rs.slot_number,
               vt.type_name AS vehicle_type,
               rs.entry_time, rs.exit_time, rs.amount,
               'Reservation' AS booking_type
        FROM reservations rs
        JOIN vehicle_types vt ON vt.id = rs.vehicle_type_id
        JOIN vehicles v       ON v.vehicle_number = rs.vehicle_number
        WHERE v.owner_id = %s
        ORDER BY rs.id DESC
    ''', (current_owner_id(),))
    reservations = c.fetchall()
    c.close(); conn.close()

    def fmt(row):
        row['entry_time'] = row['entry_time'].strftime('%Y-%m-%d %H:%M') if row['entry_time'] else ''
        row['exit_time']  = row['exit_time'].strftime('%Y-%m-%d %H:%M')  if row['exit_time']  else 'Still parked'
        row['amount']     = float(row['amount']) if row['amount'] is not None else None
        return row

    return jsonify([fmt(r) for r in records + reservations])

# ── Slots / Records ───────────────────────────────────────────────────────────

@app.route('/vehicle-types', methods=['GET'])
def get_vehicle_types():
    conn = get_db()
    c = conn.cursor(dictionary=True)
    c.execute('SELECT id, type_name, hourly_rate FROM vehicle_types ORDER BY id')
    rows = c.fetchall()
    c.close(); conn.close()
    for r in rows:
        r['hourly_rate'] = float(r['hourly_rate'])
    return jsonify(rows)


@app.route('/slots', methods=['GET'])
def get_slots():
    conn = get_db()
    c = conn.cursor(dictionary=True)
    auto_release_for_reservations(c, conn)
    c.execute('''
        SELECT s.slot_number, s.is_occupied,
               st.name AS slot_type,
               EXISTS (
                   SELECT 1 FROM reservations r
                   WHERE r.slot_number = s.slot_number
                     AND r.entry_time <= NOW()
                     AND r.exit_time  >  NOW()
               ) AS is_reserved,
               (
                   SELECT DATE_FORMAT(r2.entry_time, '%Y-%m-%dT%H:%i')
                   FROM reservations r2
                   WHERE r2.slot_number = s.slot_number
                     AND r2.exit_time > NOW()
                   ORDER BY r2.entry_time ASC LIMIT 1
               ) AS next_res_start,
               (
                   SELECT DATE_FORMAT(r3.exit_time, '%Y-%m-%dT%H:%i')
                   FROM reservations r3
                   WHERE r3.slot_number = s.slot_number
                     AND r3.exit_time > NOW()
                   ORDER BY r3.entry_time ASC LIMIT 1
               ) AS next_res_end
        FROM slots s
        JOIN slot_types st ON st.id = s.slot_type_id
        ORDER BY s.slot_number
    ''')
    rows = c.fetchall()
    c.close(); conn.close()
    for r in rows:
        r['is_occupied'] = bool(r['is_occupied'])
        r['is_reserved'] = bool(r['is_reserved'])
    return jsonify(rows)


@app.route('/records', methods=['GET'])
def get_records():
    conn = get_db()
    c = conn.cursor(dictionary=True)
    c.execute('''
        SELECT r.id, r.vehicle_number, r.slot_number,
               vt.type_name AS vehicle_type,
               r.entry_time, r.exit_time, r.amount,
               'Walk-in' AS booking_type
        FROM records r
        LEFT JOIN vehicle_types vt ON vt.id = r.vehicle_type_id
        ORDER BY r.id DESC
    ''')
    records = c.fetchall()

    c.execute('''
        SELECT rs.id, rs.vehicle_number, rs.slot_number,
               vt.type_name AS vehicle_type,
               rs.entry_time, rs.exit_time, rs.amount,
               'Reservation' AS booking_type
        FROM reservations rs
        LEFT JOIN vehicle_types vt ON vt.id = rs.vehicle_type_id
        ORDER BY rs.id DESC
    ''')
    reservations = c.fetchall()
    c.close(); conn.close()

    result = []
    for r in records:
        r['display_id'] = f"WK-{r['id']:04d}"
        r['entry_time'] = r['entry_time'].strftime('%Y-%m-%d %H:%M') if r['entry_time'] else ''
        r['exit_time']  = r['exit_time'].strftime('%Y-%m-%d %H:%M')  if r['exit_time']  else 'Still parked'
        r['amount']     = float(r['amount']) if r['amount'] is not None else None
        result.append(r)
    for r in reservations:
        r['display_id'] = f"RS-{r['id']:04d}"
        r['entry_time'] = r['entry_time'].strftime('%Y-%m-%d %H:%M') if r['entry_time'] else ''
        r['exit_time']  = r['exit_time'].strftime('%Y-%m-%d %H:%M')  if r['exit_time']  else 'Still parked'
        r['amount']     = float(r['amount']) if r['amount'] is not None else None
        result.append(r)
    result.sort(key=lambda x: x['entry_time'], reverse=True)
    return jsonify(result)


def auto_release_for_reservations(c, conn):
    """
    Release any active walk-in record whose slot now has a reservation
    that is starting (entry_time <= NOW()).  Called on assign and slot-fetch
    so the system stays consistent without a background scheduler.
    """
    c.execute('''
        SELECT rec.id, rec.slot_number
        FROM records rec
        WHERE rec.exit_time IS NULL
          AND EXISTS (
              SELECT 1 FROM reservations res
              WHERE res.slot_number = rec.slot_number
                AND res.entry_time <= NOW()
                AND res.exit_time  >  NOW()
          )
    ''')
    rows = c.fetchall()
    for row in rows:
        c.execute(
            'UPDATE records SET exit_time = NOW(), amount = NULL WHERE id = %s',
            (row['id'],)
        )
    if rows:
        conn.commit()


@app.route('/assign', methods=['POST'])
@parking_required
def assign_slot():
    data            = request.get_json()
    vehicle         = (data.get('vehicle_number') or '').strip().upper()
    slot_number     = (data.get('slot_number') or '').strip().upper()
    vehicle_type_id = int(data.get('vehicle_type_id', 1))

    if not vehicle:
        return jsonify({'error': 'Vehicle number required.'}), 400

    conn = get_db()
    c = conn.cursor(dictionary=True)
    try:
        auto_release_for_reservations(c, conn)

        c.execute('SELECT owner_id FROM vehicles WHERE vehicle_number = %s', (vehicle,))
        vrow = c.fetchone()
        if not is_guest():
            # Registered owners: vehicle must belong to them
            if not vrow:
                return jsonify({'error': f'{vehicle} is not registered. Add it in My Vehicles first.'}), 400
            if vrow['owner_id'] != current_owner_id():
                return jsonify({'error': f'{vehicle} belongs to another owner.'}), 403
            # Always use the vehicle's registered type
            c.execute('SELECT vehicle_type_id FROM vehicles WHERE vehicle_number = %s', (vehicle,))
            vehicle_type_id = (c.fetchone() or {}).get('vehicle_type_id', vehicle_type_id)
        else:
            # Guest: block if vehicle belongs to a registered owner
            if vrow:
                return jsonify({'error': f'{vehicle} is registered to an owner account. Please log in to park it.'}), 403

        c.execute('SELECT id FROM vehicle_types WHERE id = %s', (vehicle_type_id,))
        if not c.fetchone():
            return jsonify({'error': 'Invalid vehicle type.'}), 400

        if slot_number:
            c.execute('SELECT slot_number FROM slots WHERE slot_number = %s', (slot_number,))
            if not c.fetchone():
                return jsonify({'error': f'Slot {slot_number} does not exist.'}), 400
            # Block only if a reservation is active RIGHT NOW (already started)
            c.execute('''
                SELECT id FROM reservations
                WHERE slot_number = %s
                  AND entry_time <= NOW()
                  AND exit_time  >  NOW()
                LIMIT 1
            ''', (slot_number,))
            if c.fetchone():
                return jsonify({'error': f'Slot {slot_number} has an active reservation right now.'}), 409
            slot = slot_number
        else:
            # Auto-pick: prefer slots with no upcoming reservation at all,
            # falling back to slots whose next reservation hasn't started yet.
            c.execute('''
                SELECT s.slot_number,
                       MIN(res.entry_time) AS next_reservation
                FROM slots s
                LEFT JOIN reservations res
                       ON res.slot_number = s.slot_number
                      AND res.entry_time > NOW()
                WHERE s.is_occupied = 0
                  AND NOT EXISTS (
                      SELECT 1 FROM reservations r2
                      WHERE r2.slot_number = s.slot_number
                        AND r2.entry_time <= NOW()
                        AND r2.exit_time  >  NOW()
                  )
                GROUP BY s.slot_number
                ORDER BY next_reservation IS NOT NULL, next_reservation ASC, s.slot_number ASC
                LIMIT 1
            ''')
            free = c.fetchone()
            if not free:
                return jsonify({'error': 'No free slots available.'}), 400
            slot = free['slot_number']

        c.execute(
            'INSERT INTO records (vehicle_number, slot_number, vehicle_type_id, entry_time) VALUES (%s, %s, %s, %s)',
            (vehicle, slot, vehicle_type_id, datetime.now())
        )
        conn.commit()
        return jsonify({'message': f'{vehicle} assigned to slot {slot}.'})

    except mysql.connector.IntegrityError as e:
        conn.rollback()
        msg = str(e)
        if 'uq_one_active_per_vehicle' in msg:
            return jsonify({'error': f'{vehicle} is already parked.'}), 400
        if 'uq_one_active_per_slot' in msg:
            return jsonify({'error': f'Slot {slot} is already occupied.'}), 400
        return jsonify({'error': 'Database integrity error.'}), 400
    finally:
        c.close(); conn.close()


@app.route('/release', methods=['POST'])
@parking_required
def release_slot():
    data    = request.get_json()
    vehicle = (data.get('vehicle_number') or '').strip().upper()
    if not vehicle:
        return jsonify({'error': 'Vehicle number required.'}), 400

    conn = get_db()
    c = conn.cursor(dictionary=True)
    try:
        if not is_guest():
            c.execute('SELECT owner_id FROM vehicles WHERE vehicle_number = %s', (vehicle,))
            vrow = c.fetchone()
            if not vrow:
                return jsonify({'error': f'{vehicle} is not registered.'}), 400
            if vrow['owner_id'] != current_owner_id():
                return jsonify({'error': f'{vehicle} belongs to another owner.'}), 403
        else:
            # Guest: block if vehicle belongs to a registered owner
            c.execute('SELECT owner_id FROM vehicles WHERE vehicle_number = %s', (vehicle,))
            if c.fetchone():
                return jsonify({'error': f'{vehicle} is registered to an owner account. Please log in to release it.'}), 403

        c.execute('''
            SELECT r.*, vt.hourly_rate
            FROM records r
            LEFT JOIN vehicle_types vt ON vt.id = r.vehicle_type_id
            WHERE r.vehicle_number = %s AND r.exit_time IS NULL
        ''', (vehicle,))
        record = c.fetchone()
        if not record:
            return jsonify({'error': f'{vehicle} not found in active records.'}), 404

        c.execute('UPDATE records SET exit_time = %s, amount = NULL WHERE id = %s',
                  (datetime.now(), record['id']))
        conn.commit()
        return jsonify({'message': f'{vehicle} released from slot {record["slot_number"]}.'})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': 'Database error: ' + str(e)}), 500
    finally:
        c.close(); conn.close()


@app.route('/reservations/preview', methods=['POST'])
def preview_reservation():
    data = request.get_json()
    vehicle_type_id = int(data.get('vehicle_type_id', 1))
    try:
        entry = datetime.fromisoformat(data.get('entry_time', ''))
        exit_ = datetime.fromisoformat(data.get('exit_time', ''))
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid datetime format. Use YYYY-MM-DDTHH:MM'}), 400

    if exit_ <= entry:
        return jsonify({'error': 'Exit must be after entry.'}), 400

    conn = get_db()
    c = conn.cursor(dictionary=True)
    c.execute('SELECT hourly_rate FROM vehicle_types WHERE id = %s', (vehicle_type_id,))
    vt = c.fetchone()
    c.close(); conn.close()
    rate = float(vt['hourly_rate']) if vt else DEFAULT_RATE_PER_HOUR

    amount = calc_amount(entry, exit_, rate)
    delta  = exit_ - entry
    total_minutes = int(delta.total_seconds() / 60)
    hours, mins   = divmod(total_minutes, 60)
    return jsonify({
        'amount': amount,
        'hours': hours,
        'minutes': mins,
        'billed_hours': math.ceil(total_minutes / 60),
        'hourly_rate': rate,
    })


@app.route('/reservations', methods=['POST'])
@login_required
def create_reservation():
    data            = request.get_json()
    vehicle         = (data.get('vehicle_number') or '').strip().upper()
    slot_number     = (data.get('slot_number') or '').strip().upper()
    vehicle_type_id = int(data.get('vehicle_type_id', 1))

    if not vehicle:
        return jsonify({'error': 'Vehicle number required.'}), 400
    if not slot_number:
        return jsonify({'error': 'Slot number required.'}), 400

    try:
        entry = datetime.fromisoformat(data.get('entry_time', ''))
        exit_ = datetime.fromisoformat(data.get('exit_time', ''))
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid datetime format.'}), 400

    if exit_ <= entry:
        return jsonify({'error': 'Exit must be after entry.'}), 400
    if entry < datetime.now():
        return jsonify({'error': 'Entry time cannot be in the past.'}), 400

    conn = get_db()
    c = conn.cursor(dictionary=True)
    try:
        c.execute('SELECT owner_id FROM vehicles WHERE vehicle_number = %s', (vehicle,))
        vrow = c.fetchone()
        if not vrow:
            return jsonify({'error': f'{vehicle} is not registered. Add it in My Vehicles first.'}), 400
        if vrow['owner_id'] != current_owner_id():
            return jsonify({'error': f'{vehicle} belongs to another owner.'}), 403

        c.execute('SELECT hourly_rate FROM vehicle_types WHERE id = %s', (vehicle_type_id,))
        vt = c.fetchone()
        if not vt:
            return jsonify({'error': 'Invalid vehicle type.'}), 400
        rate   = float(vt['hourly_rate'])
        amount = calc_amount(entry, exit_, rate)

        c.execute('SELECT slot_number FROM slots WHERE slot_number = %s', (slot_number,))
        if not c.fetchone():
            return jsonify({'error': f'Slot {slot_number} does not exist.'}), 400

        c.execute('''
            SELECT id FROM reservations
            WHERE slot_number = %s
              AND entry_time < %s
              AND exit_time  > %s
            LIMIT 1
        ''', (slot_number, exit_, entry))
        if c.fetchone():
            return jsonify({'error': f'Slot {slot_number} is already reserved during that window.'}), 409

        c.execute('''
            SELECT id FROM reservations
            WHERE vehicle_number = %s
              AND entry_time < %s
              AND exit_time  > %s
            LIMIT 1
        ''', (vehicle, exit_, entry))
        if c.fetchone():
            return jsonify({'error': f'{vehicle} already has a reservation that overlaps that time window.'}), 409

        c.execute('''
            INSERT INTO reservations (vehicle_number, slot_number, vehicle_type_id, entry_time, exit_time, amount)
            VALUES (%s, %s, %s, %s, %s, %s)
        ''', (vehicle, slot_number, vehicle_type_id, entry, exit_, amount))
        conn.commit()
        return jsonify({
            'message': f'Reservation created for {vehicle} at slot {slot_number}.',
            'amount': amount
        })
    except Exception as e:
        conn.rollback()
        return jsonify({'error': 'Database error: ' + str(e)}), 500
    finally:
        c.close(); conn.close()


if __name__ == '__main__':
    init_db()
    app.run(debug=True)