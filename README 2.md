# Dr. P. N. Singh Clinic Website — Production Setup

This project keeps the current Gemini-developed frontend and working WhatsApp features. The backend has been hardened for MongoDB Atlas + Vercel without changing the existing WhatsApp template/message implementation.

## 1. Local setup

1. Install Node.js 18+ (Node 20+ recommended).
2. Open this project folder in a terminal.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Fill in your real local values in `.env`.
6. Run `npm start`.
7. Open `http://localhost:3000`.

Never commit `.env`, Atlas credential files, patient JSON data, `node_modules`, or `.git` from an old ZIP.

## 2. MongoDB Atlas

Create/select a MongoDB Atlas database and create a database user. Put the Atlas connection string in `MONGODB_URI`. Allow the IP access required by your development/deployment setup. The application creates its collections automatically.

Appointment numbers start fresh at `0000001` and increment atomically. Daily patient numbers use a separate atomic counter per India/IST calendar day and start at `01` each new IST day.

## 3. Admin

Set a strong random `ADMIN_KEY`. The admin page is `/admin.html`. The browser sends this key in the `x-admin-key` header.

## 4. WhatsApp

The existing Gemini WhatsApp implementation is intentionally preserved. Set the WhatsApp environment variables to the values already used by your working Meta setup. Do not rename or edit the approved templates unless you intentionally change the Meta templates too.

The webhook endpoints are:
- `GET /webhook` — Meta verification
- `POST /webhook` — incoming WhatsApp events

The webhook verification token must exactly match `WHATSAPP_VERIFY_TOKEN`.

## 5. Vercel

Import the project into GitHub and then import that repository into Vercel. Add the same production environment variables in Vercel Project Settings → Environment Variables. Do not upload `.env` or any real credential file to GitHub.

`vercel.json` routes the Express application through `server.js`. The project does not call `app.listen()` in production.

## 6. Appointment workflow

Patient booking → NEW → receptionist ACCEPT → daily Patient Number assigned → ACCEPTED → payment (Cash/UPI) → PAID → COMPLETED.

Completion is blocked until payment is marked paid. The receptionist table does not display the patient's concern.

## 7. Important production notes

- Use HTTPS through Vercel.
- Use a strong admin key and webhook verification token.
- Rotate any credentials that were previously placed inside a shared/public ZIP.
- Test the complete flow locally before production: booking, admin login, accept, patient number, cancel, payment, completed, contact form, and WhatsApp.
- This project intentionally starts the Appointment ID sequence fresh; no legacy appointment-number migration is required.
