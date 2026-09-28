const express = require('express');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const mongoose = require('mongoose');

// ========================================
// 1. INITIALIZE APP FIRST
// ========================================
const app = express();

// ========================================
// DATABASE CONNECTION (VERCEL OPTIMIZED)
// ========================================
const MONGODB_URI = process.env.MONGODB_URI || '';

async function connectToDatabase() {
    if (mongoose.connection.readyState === 1) return;
    try {
        console.log("Connecting to MongoDB Atlas...");
        await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        console.log("MongoDB Connected Successfully!");
    } catch (err) {
        console.error("Database connection error:", err);
        throw err;
    }
}

// Middleware to connect before API routes
app.use(async (req, res, next) => {
    if (req.path.startsWith('/api')) {
        try {
            await connectToDatabase();
        } catch (err) {
            return res.status(500).json({ ok: false, message: 'Database connection failed on server.' });
        }
    } else if (req.path.startsWith('/webhook')) {
        connectToDatabase().catch(err => console.error('[Webhook DB Warning]:', err));
    }
    next();
});

// ========================================
// SERVER & WHATSAPP CONFIGURATION
// ========================================
const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-this-admin-key';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v25.0';
const WHATSAPP_ENABLED = String(process.env.WHATSAPP_ENABLED || 'false').toLowerCase() === 'true';
const CLINIC_WHATSAPP_NUMBER = process.env.CLINIC_WHATSAPP_NUMBER || '';
const CLINIC_UPI_ID = process.env.CLINIC_UPI_ID || '';
const CLINIC_PHONE = process.env.CLINIC_PHONE || '';
const CLINIC_EMAIL = process.env.CLINIC_EMAIL || '';
const CLINIC_PAYMENT_NAME = process.env.CLINIC_PAYMENT_NAME || 'Dr. P. N. Singh';
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'clinic_verify_token';

const WA_TEMPLATE_REQUEST_RECEIVED = process.env.WHATSAPP_TEMPLATE_REQUEST_RECEIVED || 'appointment_request_received';
const WA_TEMPLATE_CLINIC_NEW_APPOINTMENT = process.env.WHATSAPP_TEMPLATE_CLINIC_ALERT || 'clinic_new_appointment';
const WA_TEMPLATE_LANGUAGE = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';

// ========================================
// MONGOOSE SCHEMAS & MODELS
// ========================================
const appointmentSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    appointmentNumber: { type: String, required: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
    updatedAt: String,
    status: { type: String, default: 'new' },
    patientNumber: { type: String, default: null },
    name: String,
    phone: String,
    email: String,
    date: String,
    time: String,
    mode: String,
    concern: String,
    payment: {
        status: { type: String, default: 'unpaid' },
        amount: Number,
        method: String,
        paidAt: String
    }
});

const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    nextAppointmentNumber: { type: Number, default: 0 }
}, { versionKey: false });

const patientCounterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    date: { type: String, required: true, index: true },
    nextPatientNumber: { type: Number, default: 0 }
}, { versionKey: false });

const messageSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
    status: { type: String, default: 'new' },
    name: String,
    email: String,
    phone: String,
    message: String
});

// UPGRADED SESSION SCHEMA: Added Language tracking and 5-minute Auto-Expiry TTL Index
const sessionSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    step: { type: String, default: 'idle' },
    data: {
        name: String,
        date: String,
        time: String,
        mode: String,
        concern: String,
        lang: { type: String, default: 'en' }
    }
}, { timestamps: true });

// Tells MongoDB to automatically delete the session 300 seconds (5 mins) after last update
sessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 300 });

const Appointment = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);
const PatientCounter = mongoose.models.PatientCounter || mongoose.model('PatientCounter', patientCounterSchema);
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

// ========================================
// MIDDLEWARE
// ========================================
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ========================================
// HELPERS
// ========================================
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const email = value => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const indianMobile = value => {
    const cleaned = String(value ?? '').replace(/[\s-]/g, '');
    return /^(?:\+91|91)?[6-9]\d{9}$/.test(cleaned);
};
const whatsappPhone = value => {
    const cleaned = String(value ?? '').replace(/\D/g, '');
    if (cleaned.length === 10) return '91' + cleaned;
    if (cleaned.length === 12 && cleaned.startsWith('91')) return cleaned;
    return cleaned;
};
function indiaDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const result = {};
    for (const part of parts) {
        if (part.type !== 'literal') result[part.type] = part.value;
    }
    return result;
}

const todayString = () => {
    const p = indiaDateParts();
    return `${p.year}-${p.month}-${p.day}`;
};

const isValidISODate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
};

const formatDate = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return String(value || '');
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    if (Number.isNaN(date.getTime())) return String(value || '');
    return date.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata'
    });
};

// ========================================
// NUMBER GENERATORS
// ========================================
async function generateAppointmentNumber() {
    const counter = await Counter.findOneAndUpdate(
        { _id: 'appointment_sequence' },
        { $inc: { nextAppointmentNumber: 1 } },
        { upsert: true, returnDocument: 'after' }
    ).lean();

    const num = Number(counter?.nextAppointmentNumber);
    if (!Number.isInteger(num) || num < 1) throw new Error('Appointment number generation failed.');
    return String(num).padStart(7, '0');
}

async function generatePatientNumber() {
    const date = todayString();
    const counter = await PatientCounter.findOneAndUpdate(
        { _id: `patient_${date}` },
        { $setOnInsert: { date },$inc: { nextPatientNumber: 1 } },
        { upsert: true, returnDocument: 'after' }
    ).lean();

    const num = Number(counter?.nextPatientNumber);
    if (!Number.isInteger(num) || num < 1) throw new Error('Patient number generation failed.');
    return String(num).padStart(2, '0');
}

// ========================================
// WHATSAPP API FUNCTIONS
// ========================================
const whatsappConfigured = () => {
    return WHATSAPP_ENABLED && Boolean(WHATSAPP_ACCESS_TOKEN) && Boolean(WHATSAPP_PHONE_NUMBER_ID);
};

async function sendWhatsAppTemplate(phone, templateName, parameters) {
    if (!WHATSAPP_ENABLED || !WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return { ok: false, skipped: true };

    const recipient = whatsappPhone(phone);
    if (!recipient || recipient.length < 10) return { ok: false, reason: 'Invalid phone number.' };

    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const body = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: {
            name: templateName,
            language: { code: WA_TEMPLATE_LANGUAGE },
            components: [{
                type: 'body',
                parameters: parameters.map(value => ({ type: 'text', text: String(value ?? '') }))
            }]
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('[WhatsApp] API error:', JSON.stringify(data, null, 2));
            return { ok: false, status: response.status, error: data };
        }
        return { ok: true, data };
    } catch (error) {
        console.error('[WhatsApp] Network error:', error);
        return { ok: false, error: error.message };
    }
}

async function sendWhatsAppText(phone, messageText) {
    if (!WHATSAPP_ENABLED || !WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return { ok: false, skipped: true };
    const recipient = whatsappPhone(phone);
    if (!recipient) return { ok: false, reason: 'Invalid phone' };

    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const body = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: messageText }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        return { ok: response.ok, data };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

async function sendWhatsAppInteractive(phone, messageBody, buttons) {
    if (!WHATSAPP_ENABLED || !WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return { ok: false, skipped: true };
    const recipient = whatsappPhone(phone);
    if (!recipient) return { ok: false, reason: 'Invalid phone' };

    const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const body = {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: messageBody },
            action: {
                buttons: buttons.map((btn, index) => ({
                    type: 'reply',
                    reply: { id: `btn_${index}_${Date.now()}`, title: btn.substring(0, 20) }
                }))
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        return { ok: response.ok, data };
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

async function sendAppointmentRequestReceived(appointment) {
    return sendWhatsAppTemplate(appointment.phone, WA_TEMPLATE_REQUEST_RECEIVED, [
        appointment.name, formatDate(appointment.date), appointment.time, appointment.mode
    ]);
}

async function sendClinicNewAppointment(appointment) {
    if (!CLINIC_WHATSAPP_NUMBER) return { ok: false, reason: 'Clinic WhatsApp number missing.' };
    return sendWhatsAppTemplate(CLINIC_WHATSAPP_NUMBER, WA_TEMPLATE_CLINIC_NEW_APPOINTMENT, [
        appointment.appointmentNumber, formatDate(appointment.date), appointment.time, appointment.mode, appointment.concern || 'Not provided'
    ]);
}

async function sendAppointmentAccepted(appointment) {
    const templateResult = await sendWhatsAppTemplate(appointment.phone, 'appointment_accepted', [
        appointment.name, appointment.patientNumber, formatDate(appointment.date), appointment.time, appointment.mode
    ]);

    const assistantMessage = `Hello Sir/Ma'am, I am your clinic's virtual assistant here to help guide you. Your appointment request has been accepted! Thank you for booking with Dr. P. N. Singh's clinic. Here is your confirmed patient number: *#${appointment.patientNumber}*.`;
    const buttons = ['📋 View Details', '📍 Clinic Location', '❓ FAQs'];

    await sendWhatsAppInteractive(appointment.phone, assistantMessage, buttons);
    return templateResult;
}

async function sendAppointmentCancelled(appointment) {
    const templateResult = await sendWhatsAppTemplate(appointment.phone, 'appointment_cancelled', [
        appointment.name, formatDate(appointment.date), appointment.time
    ]);

    const cancelMessage = `We are sorry to see your appointment had to be cancelled. If you need assistance or wish to plan for another day, please feel free to reach out to us.`;
    const buttons = ['📅 Book Online', '📞 Contact Clinic', '❓ FAQs'];

    await sendWhatsAppInteractive(appointment.phone, cancelMessage, buttons);
    return templateResult;
}

// ========================================
// PUBLIC ROUTES
// ========================================
app.get('/api/health', (req, res) => {
    res.json({
        ok: true, service: 'Dr. P. N. Singh Clinic', time: new Date().toISOString(),
        whatsapp: whatsappConfigured() ? 'configured' : 'not configured'
    });
});

app.get('/api/clinic', (req, res) => {
    res.json({
        doctor: 'Dr. P. N. Singh', specialty: 'Neuropsychiatrist', tagline: 'Better Mental Health, Better Quality of Life.',
        consultationFee: 400, address: 'C-190, Bilandpur New Colony, Near Platinum MRI, Gorakhpur, Uttar Pradesh',
        phone: CLINIC_PHONE, email: CLINIC_EMAIL, whatsapp: CLINIC_WHATSAPP_NUMBER,
        upiId: CLINIC_UPI_ID, paymentName: CLINIC_PAYMENT_NAME
    });
});

app.get('/api/reviews', (req, res) => res.json([]));

app.post('/api/appointments', async (req, res) => {
    const b = req.body || {};
    const name = clean(b.name, 100);
    const phone = clean(b.phone, 30);
    const mail = clean(b.email, 120);
    let date = clean(b.date, 10);
    const time = clean(b.time, 20);
    const mode = clean(b.mode, 30);
    const concern = clean(b.concern, 500);

    if (!name || !phone || !date || !time || !mode) {
        return res.status(400).json({ ok: false, message: 'Please complete name, phone, date, time and consultation mode.' });
    }
    if (!indianMobile(phone)) {
        return res.status(400).json({ ok: false, message: 'Please enter a valid 10-digit Indian mobile number.' });
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
        const [d, m, y] = date.split('/');
        date = `${y}-${m}-${d}`;
    }

    if (!isValidISODate(date)) {
        return res.status(400).json({ ok: false, message: 'Please choose a valid date.' });
    }
    if (date < todayString()) {
        return res.status(400).json({ ok: false, message: 'Please choose today or a future date.' });
    }
    if (!email(mail)) {
        return res.status(400).json({ ok: false, message: 'Please enter a valid email address.' });
    }

    const appointmentNumber = await generateAppointmentNumber();

    const appointment = {
        id: crypto.randomUUID(),
        appointmentNumber,
        createdAt: new Date().toISOString(),
        status: 'new',
        patientNumber: null,
        name, phone, email: mail, date, time, mode, concern,
        payment: { status: 'unpaid', amount: null, method: null, paidAt: null }
    };

    await Appointment.create(appointment);

    const whatsappResult = await sendAppointmentRequestReceived(appointment);
    const clinicWhatsappResult = await sendClinicNewAppointment(appointment);

    res.status(201).json({
        ok: true,
        message: 'Your appointment request has been received. The clinic will confirm the appointment.',
        appointmentId: appointment.id,
        appointmentNumber: appointment.appointmentNumber,
        whatsapp: { patient: whatsappResult.ok ? 'sent' : 'failed', clinic: clinicWhatsappResult.ok ? 'sent' : 'failed' }
    });
});

app.post('/api/contact', async (req, res) => {
    const b = req.body || {};
    const name = clean(b.name, 100);
    const mail = clean(b.email, 120);
    const phone = clean(b.phone, 30);
    const message = clean(b.message, 1500);

    if (!name || (!mail && !phone) || !message) {
        return res.status(400).json({ ok: false, message: 'Please provide your name, one contact method and your message.' });
    }
    if (!email(mail)) {
        return res.status(400).json({ ok: false, message: 'Please enter a valid email address.' });
    }

    const contactMessage = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: 'new',
        name, email: mail, phone, message
    };

    await Message.create(contactMessage);
    res.status(201).json({ ok: true, message: 'Your message has been received. The clinic will get back to you.' });
});

// ========================================
// ADMIN AUTHENTICATION
// ========================================
function admin(req, res, next) {
    const key = req.get('x-admin-key') || req.query.key;
    if (key !== ADMIN_KEY) return res.status(401).json({ ok: false, message: 'Unauthorized.' });
    next();
}

// ========================================
// ADMIN ROUTES
// ========================================
app.get('/api/admin/appointments', admin, async (req, res) => {
    const appointments = await Appointment.find({ date: { $gte: todayString() } }).sort({ date: 1, time: 1, createdAt: -1 });
    res.json({ ok: true, appointments });
});

app.patch('/api/admin/appointments/:id', admin, async (req, res) => {
    const appointment = await Appointment.findOne({ id: req.params.id });
    if (!appointment) return res.status(404).json({ ok: false, message: 'Appointment not found.' });

    const status = clean(req.body?.status, 30);
    if (!['new', 'accepted', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({ ok: false, message: 'Invalid appointment status.' });
    }

    if (appointment.status === status) {
        return res.json({ ok: true, appointment, message: 'Status already set.' });
    }

    if (status === 'accepted') {
        if (appointment.status !== 'new') {
            return res.status(400).json({ ok: false, message: 'Only a new appointment can be accepted.' });
        }

        const patientNumber = appointment.patientNumber || await generatePatientNumber();
        const updated = await Appointment.findOneAndUpdate(
            { id: appointment.id, status: 'new', patientNumber: null },
            {
                $set: {
                    patientNumber,
                    status: 'accepted',
                    updatedAt: new Date().toISOString(),
                    payment: appointment.payment || { status: 'unpaid', amount: null, method: null, paidAt: null }
                }
            },
            { returnDocument: 'after' }
        );

        if (!updated) {
            return res.status(409).json({ ok: false, message: 'This appointment was already updated. Please refresh the dashboard.' });
        }

        const whatsappResult = await sendAppointmentAccepted(updated);
        return res.json({ ok: true, appointment: updated, whatsapp: whatsappResult.ok ? 'sent' : 'failed' });
    }

    if (status === 'cancelled') {
        appointment.status = 'cancelled';
        appointment.updatedAt = new Date().toISOString();
        await appointment.save();

        const whatsappResult = await sendAppointmentCancelled(appointment);
        return res.json({ ok: true, appointment, whatsapp: whatsappResult.ok ? 'sent' : 'failed' });
    }

    if (status === 'completed') {
        if (!appointment.patientNumber) return res.status(400).json({ ok: false, message: 'Patient number missing.' });
        if (!appointment.payment || appointment.payment.status !== 'paid') {
            return res.status(400).json({ ok: false, message: 'Payment must be marked as paid.' });
        }
        appointment.status = 'completed';
        appointment.updatedAt = new Date().toISOString();
        await appointment.save();
        return res.json({ ok: true, appointment, whatsapp: 'not_required' });
    }

    if (status === 'new') {
        appointment.status = 'new';
        appointment.updatedAt = new Date().toISOString();
        await appointment.save();
        return res.json({ ok: true, appointment, whatsapp: 'not_required' });
    }
});

app.patch('/api/admin/appointments/:id/payment', admin, async (req, res) => {
    const appointment = await Appointment.findOne({ id: req.params.id });
    if (!appointment) return res.status(404).json({ ok: false, message: 'Appointment not found.' });
    if (appointment.status !== 'accepted') return res.status(400).json({ ok: false, message: 'Appointment must be accepted.' });

    const amount = Number(req.body?.amount);
    const method = clean(req.body?.method, 20).toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, message: 'Invalid payment amount.' });
    if (!['cash', 'upi'].includes(method)) return res.status(400).json({ ok: false, message: 'Select Cash or UPI.' });

    appointment.payment = { status: 'paid', amount, method, paidAt: new Date().toISOString() };
    appointment.updatedAt = new Date().toISOString();
    await appointment.save();

    res.json({ ok: true, appointment, message: 'Payment marked as paid.' });
});

app.get('/api/admin/payment-info', admin, (req, res) => {
    res.json({ ok: true, upiId: CLINIC_UPI_ID, paymentName: CLINIC_PAYMENT_NAME });
});

app.get('/api/admin/messages', admin, async (req, res) => {
    const messages = await Message.find().sort({ createdAt: -1 });
    res.json({ ok: true, messages });
});

// ========================================
// WHATSAPP BILINGUAL BOT DICTIONARY
// ========================================
const i18n = {
    en: {
        greeting: `Hello! I am Dr. P. N. Singh Clinic's virtual assistant. How can we assist you today?`,
        btnBook: '📅 Book Appointment',
        btnLocation: '📍 Clinic Location',
        btnFees: '💵 Fees & Timings',
        locationText: `📍 *Clinic Location*\n\nDr. P. N. Singh Clinic\nC-190, Bilandpur New Colony, Near Platinum MRI, Gorakhpur, Uttar Pradesh.\n\n🗺️ *Google Maps:* https://maps.google.com/?q=Bilandpur+Gorakhpur`,
        feeText: `💵 *Fees & Consultation Timings*\n\n• *Doctor:* Dr. P. N. Singh (Neuropsychiatrist)\n• *Fee:* ₹400 per session\n• *Clinic Hours:* Monday to Saturday, 10:00 AM – 7:00 PM (Closed Sundays).`,
        askName: `📅 *WhatsApp Appointment Booking*\n\nLet's get you scheduled! First, please reply with your *Full Name*:`,
        askDate: (name) => `Thank you, *${name}*.\n\nNow, what date would you like to book? (Please enter in format: *YYYY-MM-DD*, e.g., 2026-09-01)`,
        askTime: `Got it. What preferred time slot would you like? (e.g., *11:00 AM* or *Evening*)`,
        askMode: `Please choose your consultation mode:\n\n1️⃣ *Clinic Visit*\n2️⃣ *Online Consultation*\n\n(Simply reply with *Clinic* or *Online*)`,
        askConcern: `Almost done! Do you have any specific health concern or symptoms to share?\n\n*(Type your concern or simply type *Skip* to bypass)*`,
        confirm: (appt) => `✅ *Appointment Request Submitted Successfully!*\n\n• *Appointment No:* #${appt.appointmentNumber}\n• *Date:* ${formatDate(appt.date)}\n• *Time:* ${appt.time}\n• *Mode:* ${appt.mode}\n\nThe clinic will confirm your appointment shortly. You will receive a message with your token number here!`
    },
    hi: {
        greeting: `नमस्ते! मैं डॉ. पी. एन. सिंह क्लीनिक का वर्चुअल असिस्टेंट हूँ। आज हम आपकी कैसे मदद कर सकते हैं?`,
        btnBook: '📅 अपॉइंटमेंट बुक', 
        btnLocation: '📍 क्लीनिक का पता',
        btnFees: '💵 फीस और समय',
        locationText: `📍 *क्लीनिक का पता*\n\nडॉ. पी. एन. सिंह क्लीनिक\nसी-190, बिलंदपुर न्यू कॉलोनी, प्लैटिनम एमआरआई के पास, गोरखपुर, उत्तर प्रदेश।\n\n🗺️ *गूगल मैप्स:* https://maps.google.com/?q=Bilandpur+Gorakhpur`,
        feeText: `💵 *फीस और समय*\n\n• *डॉक्टर:* डॉ. पी. एन. सिंह (न्यूरोसाइकियाट्रिस्ट)\n• *फीस:* ₹400 प्रति सेशन\n• *समय:* सोमवार - शनिवार, सुबह 10:00 – शाम 7:00 (रविवार बंद)।`,
        askName: `📅 *व्हाट्सएप अपॉइंटमेंट बुकिंग*\n\nचलिए आपका अपॉइंटमेंट तय करते हैं! सबसे पहले, कृपया अपना *पूरा नाम* लिखकर भेजें:`,
        askDate: (name) => `धन्यवाद, *${name}*।\n\nआप किस तारीख को अपॉइंटमेंट बुक करना चाहते हैं? (तारीख ऐसे लिखें: *YYYY-MM-DD*, उदाहरण: 2026-09-01)`,
        askTime: `समझ गया। आप कौन सा समय पसंद करेंगे? (उदाहरण: *11:00 AM* या *शाम*)`,
        askMode: `कृपया परामर्श का माध्यम चुनें:\n\n1️⃣ *क्लीनिक आकर*\n2️⃣ *ऑनलाइन परामर्श*\n\n(बस *क्लीनिक* या *ऑनलाइन* लिखकर भेजें)`,
        askConcern: `लगभग पूरा हो गया! क्या आपको अपनी किसी समस्या के बारे में बताना है?\n\n*(अपनी समस्या लिखें या इसे छोड़ने के लिए *Skip* लिखें)*`,
        confirm: (appt) => `✅ *अपॉइंटमेंट का अनुरोध सफलतापूर्वक हो गया!*\n\n• *अपॉइंटमेंट नंबर:* #${appt.appointmentNumber}\n• *तारीख:* ${formatDate(appt.date)}\n• *समय:* ${appt.time}\n• *माध्यम:* ${appt.mode}\n\nक्लीनिक जल्द ही आपके अपॉइंटमेंट की पुष्टि करेगा और आपको यहाँ टोकन नंबर भेज दिया जाएगा!`
    }
};

// ========================================
// WHATSAPP WEBHOOK ROUTING & ACTIONS
// ========================================
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
            console.log('[Webhook] Verified successfully!');
            return res.status(200).send(challenge);
        }
        return res.sendStatus(403);
    }
    return res.sendStatus(400);
});

app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;

        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry || []) {
                for (const change of entry.changes || []) {
                    const value = change.value;
                    if (value && value.messages && value.messages.length > 0) {
                        const message = value.messages[0];
                        const senderPhone = message.from;

                        let session = await Session.findOne({ phone: senderPhone });
                        if (!session) {
                            session = await Session.create({ phone: senderPhone, step: 'idle', data: { lang: 'en' } });
                        }
                        
                        if (!session.data) session.data = {};
                        const lang = session.data.lang || 'en';

                        // 1. Handle interactive button clicks
                        if (message.type === 'interactive' && message.interactive?.button_reply) {
                            const btnTitle = message.interactive.button_reply.title || '';

                            if (btnTitle === 'English' || btnTitle === 'हिंदी') {
                                const chosenLang = btnTitle === 'English' ? 'en' : 'hi';
                                session.data.lang = chosenLang;
                                session.step = 'idle';
                                await session.save();
                                await sendWhatsAppInteractive(senderPhone, i18n[chosenLang].greeting, [i18n[chosenLang].btnBook, i18n[chosenLang].btnLocation, i18n[chosenLang].btnFees]);
                            } 
                            else if (btnTitle.includes('Location') || btnTitle.includes('पता') || btnTitle.includes('FAQs')) {
                                await session.save(); // Refreshes the 5-minute TTL timer
                                await sendWhatsAppText(senderPhone, i18n[lang].locationText);
                            } 
                            else if (btnTitle.includes('Fees') || btnTitle.includes('फीस') || btnTitle.includes('Timings')) {
                                await session.save(); 
                                await sendWhatsAppText(senderPhone, i18n[lang].feeText);
                            } 
                            else if (btnTitle.includes('Book') || btnTitle.includes('अपॉइंटमेंट') || btnTitle.includes('Pre-book')) {
                                session.step = 'awaiting_name';
                                session.data.name = ''; session.data.date = ''; session.data.time = ''; session.data.mode = ''; session.data.concern = '';
                                await session.save();
                                await sendWhatsAppText(senderPhone, i18n[lang].askName);
                            }
                            else if (btnTitle.includes('Contact')) {
                                const contactText = `📞 *Clinic Contact*\n\n• Clinic Desk: Available during OPD hours\n• Address: Bilandpur New Colony, Gorakhpur\n• Online Portal: https://drpnsingh.vercel.app/`;
                                await sendWhatsAppText(senderPhone, contactText);
                            }
                        }
                        // 2. Handle Text Inputs
                        else if (message.type === 'text') {
                            const userText = message.text.body.trim();
                            const isGreeting = ['hi', 'hii', 'hello', 'hey', 'नमस्ते'].includes(userText.toLowerCase());

                            if (isGreeting || session.step === 'idle') {
                                session.step = 'awaiting_language';
                                await session.save();
                                const langPrompt = `Welcome to Dr. P. N. Singh's Clinic! 🏥\n\nPlease choose your preferred language / कृपया अपनी पसंदीदा भाषा चुनें:`;
                                await sendWhatsAppInteractive(senderPhone, langPrompt, ['English', 'हिंदी']);
                            } 
                            else if (session.step === 'awaiting_name') {
                                session.data.name = clean(userText, 100);
                                session.step = 'awaiting_date';
                                await session.save();
                                await sendWhatsAppText(senderPhone, i18n[lang].askDate(session.data.name));
                            } 
                            else if (session.step === 'awaiting_date') {
                                session.data.date = clean(userText, 10);
                                session.step = 'awaiting_time';
                                await session.save();
                                await sendWhatsAppText(senderPhone, i18n[lang].askTime);
                            } 
                            else if (session.step === 'awaiting_time') {
                                session.data.time = clean(userText, 20);
                                session.step = 'awaiting_mode';
                                await session.save();
                                await sendWhatsAppText(senderPhone, i18n[lang].askMode);
                            } 
                            else if (session.step === 'awaiting_mode') {
                                session.data.mode = clean(userText, 30);
                                session.step = 'awaiting_concern';
                                await session.save();
                                await sendWhatsAppText(senderPhone, i18n[lang].askConcern);
                            } 
                            else if (session.step === 'awaiting_concern') {
                                const rawConcern = clean(userText, 500);
                                session.data.concern = (rawConcern.toLowerCase() === 'none' || rawConcern.toLowerCase() === 'skip') ? '' : rawConcern;
                                session.step = 'idle';
                                await session.save();

                                const appointmentNumber = await generateAppointmentNumber();
                                const formattedPhone = whatsappPhone(senderPhone);

                                const appointment = {
                                    id: crypto.randomUUID(),
                                    appointmentNumber,
                                    createdAt: new Date().toISOString(),
                                    status: 'new',
                                    patientNumber: null,
                                    name: session.data.name,
                                    phone: formattedPhone,
                                    email: '', 
                                    date: session.data.date,
                                    time: session.data.time,
                                    mode: session.data.mode,
                                    concern: session.data.concern,
                                    payment: { status: 'unpaid', amount: null, method: null, paidAt: null }
                                };

                                await Appointment.create(appointment);
                                await sendAppointmentRequestReceived(appointment);
                                await sendClinicNewAppointment(appointment);
                                await sendWhatsAppText(senderPhone, i18n[lang].confirm(appointment));
                            }
                        }
                    }
                }
            }
            return res.status(200).send('EVENT_RECEIVED');
        }
        return res.sendStatus(404);
    } catch (error) {
        console.error('[Webhook Error]:', error);
        return res.sendStatus(500);
    }
});

// ========================================
// API ERROR HANDLER
// ========================================
app.use((error, req, res, next) => {
    console.error('[Server Error]', error);
    if (res.headersSent) return next(error);
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
        return res.status(500).json({ ok: false, message: 'An unexpected server error occurred.' });
    }
    return res.status(500).send('Internal Server Error');
});

// ========================================
// FALLBACK & SERVER START
// ========================================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server running locally at http://localhost:${PORT}`);
    });
}

module.exports = app;