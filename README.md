# Wrench & Co.

## Run locally

Use Node.js 22.13 or newer. Copy `.env.example` to `.env`, set a MongoDB connection string and private administrator password, then install dependencies before starting the server. Keep `.env` private and never commit it.

```powershell
npm install
npm start
```

Open `http://127.0.0.1:8000`. MongoDB is the durable store. On first connection, existing records from `.data/wrench.sqlite` are copied into MongoDB only when the workshop collections are empty; on later starts MongoDB data is loaded into the local SQLite working copy. Successful API writes are committed to MongoDB before the response is sent. The service serializes API requests and is intended to run as one instance.

The local demo administrator is `admin@wrenchco.in` / `wrench123` when `ADMIN_PASSWORD` is not set. Set a private password before sharing the site. The server listens on `127.0.0.1` by default. `MONGO_URL` is required unless `DATABASE_BACKEND=sqlite` is explicitly selected for isolated tests. `MONGO_DB_NAME` optionally overrides the database name in the URI. `DATABASE_PATH` selects the local SQLite working copy, defaulting to `.data/wrench.sqlite`.

```powershell
$env:ADMIN_EMAIL = "workshop@example.com"
$env:ADMIN_PASSWORD = "a-long-private-password"
$env:DATABASE_PATH = ".data/wrench.sqlite"
$env:PORT = "8000"
npm start
```

For a production deployment, set `NODE_ENV=production`, `MONGO_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `HOST=0.0.0.0`, and place the server behind an HTTPS reverse proxy. Production startup refuses to use the demo administrator account. Admin sessions are HTTP-only, same-site cookies and expire after eight hours. Back up MongoDB; the local SQLite file is a working copy, not the production backup.

## Publish on Render

The `render.yaml` Blueprint deploys the website and API together at one public URL and connects to MongoDB. It prompts for the private `MONGO_URL`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. The Blueprint uses Render's free web plan; its local SQLite working copy is rebuilt from MongoDB on restarts, so MongoDB must be reachable and retain your records.

In Render, create a new Blueprint from `Ganeshvicky842/mech`, then provide the MongoDB URI and private admin credentials when prompted. Do not use the local demo credentials in production. After deployment, the Render URL serves both the frontend and `/api/*`. To enable password recovery, add the HTTPS service URL as `APP_BASE_URL` and configure `ADMIN_RECOVERY_EMAIL`, `SMTP_USER`, `SMTP_APP_PASSWORD`, and any required SMTP settings in the service environment.

## Administrator password recovery

The administrator sign-in screen includes **Forgot password?**. Recovery links are sent to `ramollarakesh143@gmail.com` by default (override with `ADMIN_RECOVERY_EMAIL`). Configure Gmail SMTP and the public HTTPS site URL in the server's private `.env` file:

```dotenv
ADMIN_RECOVERY_EMAIL=ramollarakesh143@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-sending-gmail-address@gmail.com
SMTP_APP_PASSWORD=your-private-google-app-password
APP_BASE_URL=https://your-public-site.example
```

Create a Google App Password for the sending Gmail account and keep it private; do not commit it or share it in chat. The sender account must be permitted to send mail through Gmail SMTP. In production, recovery is disabled unless SMTP settings and an HTTPS `APP_BASE_URL` are configured. For local testing, set `APP_BASE_URL=http://127.0.0.1:8000`; emailed links will only open on a device that can access that local server.

Reset tokens are stored only as hashes, expire after 30 minutes, and can be used once. A successful reset stores a salted password hash in SQLite and invalidates active administrator sessions. The updated password remains active across server restarts and database backups must include `.data`.

## Backend features

- SQLite persistence for bookings, emergency roadside requests, mechanics, mechanic salary and attendance records, parts inventory, customer parts requests, invoices, offers and the sales ledger.
- Public APIs for mechanic availability, catalogue browsing, appointment slots, bookings, roadside requests and parts requests.
- Session-protected administrator APIs and dashboard controls for appointments, emergency requests, mechanic performance, attendance, salaries, parts orders, inventory, offers, bills and transactions.
- Mechanic check-in and check-out timestamps are saved per workday; monthly performance shows completed assigned bookings and hours worked. Set each mechanic's monthly salary from the Team performance page.
- Appointment slot validation and conflict protection run on the server, so two customers cannot book the same active slot.
- Customer-submitted help requests appear in the administrator's **Roadside help** panel. Customers are told to call the published helpline to confirm dispatch and an arrival estimate.

## API overview

Public:

- `GET /api/health`, `GET /api/mechanics`, `GET /api/catalog`
- `GET /api/availability?date=YYYY-MM-DD`
- `POST /api/bookings`, `POST /api/roadside-requests`, `POST /api/part-orders`

Administrator (sign in at `POST /api/admin/login`; subsequent calls use its session cookie):

- `GET /api/admin/session`, `POST /api/admin/logout`, `GET /api/admin/bootstrap`
- `POST /api/admin/forgot-password`, `POST /api/admin/reset-password`
- `PATCH /api/admin/bookings/:id`, `PATCH /api/admin/roadside-requests/:id`
- `POST /api/admin/mechanics`, `PATCH /api/admin/mechanics/:id`
- `PATCH /api/admin/mechanics/:id/salary`, `POST /api/admin/mechanic-attendance`
- `PATCH /api/admin/part-orders/:id`, `POST /api/admin/inventory`, `PATCH /api/admin/inventory/:sku`
- `PATCH /api/admin/invoices/:id`, `POST /api/admin/transactions`, `POST /api/admin/offers`

All request bodies are JSON. Validation errors use a JSON `error` message and an appropriate HTTP status. Cancelling a parts request returns its reserved quantities to stock; invoice payments are idempotent.

## Tests

```powershell
npm test
```
