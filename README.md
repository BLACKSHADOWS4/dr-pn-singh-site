# Dr. P. N. Singh Website

## Run
npm install
copy .env.example .env
npm start
Open http://localhost:3000

## Backend
POST /api/appointments stores requests in data/appointments.json.
POST /api/contact stores messages in data/messages.json.
GET /api/health checks the server.
GET /api/admin/appointments with x-admin-key lists appointments.
PATCH /api/admin/appointments/:id with x-admin-key changes status: new, confirmed, completed, cancelled.
GET /api/admin/messages with x-admin-key lists contact messages.

## Before publishing
Replace placeholder doctor images, phone, email, WhatsApp, social links and confirm the exact clinic address/map pin. Add HTTPS, secure authentication, database, backups, rate limiting, spam protection, audit logs and privacy/consent controls before collecting real patient information publicly.
