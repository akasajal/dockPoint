# DockPoint

A local-first parking lot management system built with Flask and MySQL. Supports walk-in vehicle entry, advance reservations, per-type billing, and an interactive slot map — all from a clean terminal-aesthetic web UI.

---

## Features

- **Interactive slot map** — colour-coded grid (Regular / EV / Handicapped) with live occupancy and reservation status
- **Walk-in entry & release** — assign any free slot to a vehicle instantly; release logs exit time automatically
- **Advance reservations** — book a specific slot for a future time window with a live cost preview before confirming
- **Per-type hourly billing** — each vehicle type carries its own rate; billing is ceiling-rounded to the nearest hour
- **Auto-release** — walk-in records whose slot has an upcoming reservation are cleared automatically on slot fetch or assign
- **Account system** — register / login via email or phone; guests can park unregistered vehicles without an account
- **Vehicle management** — registered owners can maintain a list of their vehicles with associated types
- **System status panel** — live counts of free, occupied, and reserved slots (EV and HC broken out separately)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3 · Flask |
| Database | MySQL (via `mysql-connector-python`) |
| Auth | `bcrypt` password hashing, Flask sessions |
| Frontend | Vanilla JS · HTML/CSS (no framework) |
| Fonts | Syne + Share Tech Mono (Google Fonts) |

---

## Project Structure

```
.
├── app.py              # Flask app — all routes, DB init, business logic
├── templates/
│   ├── index.html      # Main dashboard
│   ├── login.html      # Login / register page
│   ├── profile.html    # Account profile editor
│   └── vehicles.html   # Manage registered vehicles
├── static/
│   ├── index.css       # Global styles
│   ├── api.js          # Fetch wrappers for every API endpoint
│   ├── slots.js        # Slot grid rendering and click-selection
│   ├── reservations.js # Reservation preview and creation
│   └── ui.js           # Records table, vehicle-type loader, misc UI helpers
├── .env                # Environment variables (not committed)
└── .gitignore
```

---

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/akasajal/dockPoint.git
cd dockpoint
pip install flask mysql-connector-python bcrypt python-dotenv
```

### 2. Create a virtual environment

```bash
python -m venv venv
venv\Scripts\activate  # Windows
source venv/bin/activate  # Mac/Linux
```

### 3. Configure environment

Copy `.env.example` to `.env` (or create `.env`) and fill in your values:

```env
FLASK_SECRET_KEY=change-me-to-something-random

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=dockpoint
```

### 4. Create the database

```sql
CREATE DATABASE dockpoint CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

The application creates all tables, triggers, and seed data automatically on first run.

### 5. Run

```bash
python app.py
```

Visit `http://localhost:5000`. You'll be redirected to the login page; use **Continue as Guest** to skip registration.

---

## Slot Layout

The lot has **124 slots** across 7 rows, seeded on first run:

| Rows | Columns | Total |
|---|---|---|
| A – D | 1 – 16 | 64 |
| E – G | 1 – 20 | 60 |

**Special slots (set at init, can be changed in DB):**

- **Handicapped** — column 1 and last column of every row (e.g. `A1`, `A16`, `G20`)
- **EV** — `A5`–`A12` and `B5`–`B12`

---

## API Reference

All endpoints return JSON. Session cookies handle authentication.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create account (`owner_name`, `email`/`phone_number`, `password`) |
| `POST` | `/auth/login` | Login (`identifier`, `password`) |
| `POST` | `/auth/logout` | Clear session |
| `POST` | `/auth/guest` | Start a guest session |
| `GET` | `/auth/me` | Current session info |

### Owner

| Method | Path | Description |
|---|---|---|
| `GET` | `/owner/profile` | Get profile (login required) |
| `PUT` | `/owner/profile` | Update name / email / phone / password |
| `GET` | `/owner/vehicles` | List registered vehicles |
| `POST` | `/owner/vehicles` | Add vehicle (`vehicle_number`, `vehicle_type_id`) |
| `DELETE` | `/owner/vehicles/<number>` | Remove vehicle |
| `GET` | `/owner/records` | Personal walk-in and reservation history |

### Parking

| Method | Path | Description |
|---|---|---|
| `GET` | `/vehicle-types` | List all vehicle types with hourly rates |
| `GET` | `/slots` | All slots with occupancy and reservation state |
| `GET` | `/records` | All walk-in and reservation records |
| `POST` | `/assign` | Assign a slot (`vehicle_number`, `slot_number`?, `vehicle_type_id`) |
| `POST` | `/release` | Release a vehicle (`vehicle_number`) |
| `POST` | `/reservations/preview` | Cost estimate (`entry_time`, `exit_time`, `vehicle_type_id`) |
| `POST` | `/reservations` | Create a reservation (login required) |

---

## Billing

Charges are calculated as:

```
amount = ceil(duration_in_minutes / 60) × hourly_rate
```

Default rates seeded at init:

| Vehicle Type | Rate |
|---|---|
| Bicycle | $1.00 / hr |
| Motorcycle | $2.00 / hr |
| Car | $3.00 / hr |
| Van | $3.00 / hr |
| Truck | $4.00 / hr |
| Bus | $4.00 / hr |

Rates can be updated directly in the `vehicle_types` table.

---

## Guest vs. Registered Users

| Action | Guest | Registered Owner |
|---|---|---|
| View slots & records | ✅ | ✅ |
| Park an unregistered vehicle | ✅ | — |
| Park / release own vehicles | — | ✅ |
| Create advance reservations | — | ✅ (login required) |
| Manage vehicle list | — | ✅ |

Guests cannot park vehicles that are already registered to an owner account (and vice-versa).

---

## Database Schema (summary)

```
owners          — accounts (name, email, phone, bcrypt hash)
vehicles        — vehicle registry (number, owner_id, vehicle_type_id)
vehicle_types   — type catalogue with hourly rates
slots           — physical slots with occupancy flag and type
slot_types      — Regular | EV | Handicapped
records         — walk-in sessions (entry/exit times, amount)
reservations    — advance bookings (time window, amount)
```

MySQL triggers on `records` keep `slots.is_occupied` in sync automatically on insert, update, and delete.

---

## License

MIT © [akasajal](https://github.com/akasajal)