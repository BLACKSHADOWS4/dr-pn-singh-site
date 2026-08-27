const express = require('express');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const mongoose = require('mongoose');

// ========================================
// 1. INITIALIZE APP FIRST (CRITICAL FIX)
// ========================================
const app = express();

// ========================================
// DATABASE CONNECTION (VERCEL OPTIMIZED)
// ========================================
const MONGODB_URI = process.env.MONGODB_URI || '';

async function connectToDatabase() {
    if (mongoose.connection.readyState === 1) {
        return;
    }
    try {
        console.log("Connecting to MongoDB Atlas...");
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000 // Timeout quickly if it fails instead of hanging
        });
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
const WHATSAPP_ENABLED = String(process.env.WHATSAPP_ENABLED || 'true').toLowerCase() === 'true';
const CLINIC_WHATSAPP_NUMBER = process.env.CLINIC_WHATSAPP_NUMBER || '';
const CLINIC_UPI_ID = process.env.CLINIC_UPI_ID || '';
const CLINIC_PAYMENT_NAME = process.env.CLINIC_PAYMENT_NAME || 'Dr. P. N. Singh';

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
    _id: { type: String, default: 'global_counters' },
    nextAppointmentNumber: { type: Number, default: 1 },
    patientDate: { type: String, default: '' },
    nextPatientNumber: { type: Number, default: 1 }
});

const messageSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
    status: { type: String, default: 'new' },
    name: String,
    email: String,
    phone: String,
    message: String
});

const Appointment = mongoose.model('Appointment', appointmentSchema);
const Counter = mongoose.model('Counter', counterSchema);
const Message = mongoose.model('Message', messageSchema);

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
const formatDate = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
};
const todayString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// ========================================
// NUMBER GENERATORS (DATABASE BASED)
// ========================================
async function generateAppointmentNumber() {
    let counter = await Counter.findById('global_counters');
    if (!counter) {
        counter = await Counter.create({ _id: 'global_counters', nextAppointmentNumber: 1 });
    }
    const num = counter.nextAppointmentNumber || 1;
    counter.nextAppointmentNumber = num + 1;
    await counter.save();
    return String(num).padStart(7, '0');
}

async function generatePatientNumber() {
    let counter = await Counter.findById('global_counters');
    const today = todayString();
    
    if (!counter) {
        counter = await Counter.create({ _id: 'global_counters', patientDate: today, nextPatientNumber: 1 });
    }
    
    if (counter.patientDate !== today) {
        counter.patientDate = today;
        counter.nextPatientNumber = 1;
    }
    
    const num = counter.nextPatientNumber || 1;
    counter.nextPatientNumber = num + 1;
    await counter.save();
    return String(num).padStart(2, '0');
}

// ========================================
// WHATSAPP FUNCTIONS & INTERACTIVE BUTTONS
// ========================================
const whatsappConfigured = () => {
    return WHATSAPP_ENABLED && Boolean(WHATSAPP_ACCESS_TOKEN) && Boolean(WHATSAPP_PHONE_NUMBER_ID);
};

async function sendWhatsAppTemplate(phone, templateName, parameters) {
    if (!WHATSAPP_ENABLED) return { ok: false, skipped: true, reason: 'WhatsApp disabled.' };
    if (!WHATSAPP_ACCESS_TOKEN) return { ok: false, skipped: true, reason: 'WhatsApp access token missing.' };
    if (!WHATSAPP_PHONE_NUMBER_ID) return { ok: false, skipped: true, reason: 'WhatsApp phone number ID missing.' };

    const recipient = whatsappPhone(phone);
    if (!recipient || recipient.length < 10) return { ok: false, reason: 'Invalid recipient phone number.' };

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
        console.log(`[WhatsApp] Template "${templateName}" sent to ${recipient}`);
        return { ok: true, data };
    } catch (error) {
        console.error('[WhatsApp] Network/request error:', error);
        return { ok: false, error: error.message };
    }
}

// Helper to send raw WhatsApp interactive button payloads (Session Message)
async function sendWhatsAppInteractive(phone, messageBody, buttons) {
    if (!WHATSAPP_ENABLED) return { ok: false, skipped: true };
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
                    reply: { id: `btn_${index}_${Date.now()}`, title: btn.substring(0, 20) } // WhatsApp max title length is 20 chars
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
        if (!response.ok) {
            console.error('[WhatsApp] Interactive message error:', JSON.stringify(data, null, 2));
            return { ok: false, error: data };
        }
        return { ok: true, data };
    } catch (error) {
        console.error('[WhatsApp] Interactive network error:', error);
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
    // 1. Send the official approved template first
    const templateResult = await sendWhatsAppTemplate(appointment.phone, 'appointment_accepted', [
        appointment.name, formatDate(appointment.date), appointment.time, appointment.mode, appointment.patientNumber
    ]);

    // 2. Send your custom AI assistant greeting + 3 Interactive Buttons immediately after
    const assistantMessage = `Hello Sir/Ma'am, I am your clinic's virtual assistant here to help guide you. Your appointment request has been accepted! Thank you for booking with Dr. P. N. Singh's clinic. Here is your confirmed patient number: *#${appointment.patientNumber}*.`;
    const buttons = ['📋 View Details', '📍 Clinic Location', '❓ FAQs'];
    
    await sendWhatsAppInteractive(appointment.phone, assistantMessage, buttons);
    return templateResult;
}

async function sendAppointmentCancelled(appointment) {
    // 1. Send the official approved cancellation template first
    const templateResult = await sendWhatsAppTemplate(appointment.phone, WA_TEMPLATE_CANCELLED, [
        appointment.name, formatDate(appointment.date), appointment.time
    ]);

    // 2. Send your empathetic cancellation message + 3 Interactive Buttons immediately after
    const cancelMessage = `We are sorry to see your appointment had to be cancelled. If you need assistance or wish to plan for another day, please feel free to reach out to us.`;
    const buttons = ['📅 Pre-book Tomorrow', '📞 Contact Clinic', '❓ FAQs'];

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
        phone: '+91 00000 00000', email: 'clinic@example.com', whatsapp: '910000000000',
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

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ ok: false, message: 'Please choose a valid date.' });
    }
    const requestedDate = new Date(`${date}T00:00:00`);
    if (Number.isNaN(requestedDate.getTime())) {
        return res.status(400).json({ ok: false, message: 'Please choose a valid date.' });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (requestedDate < today) {
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

    if (!whatsappResult.ok) console.error(`[Appointment ${appointment.id}] Patient WhatsApp failed.`);
    if (!clinicWhatsappResult.ok) console.error(`[Appointment ${appointment.id}] Clinic WhatsApp failed.`);

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

    const oldStatus = appointment.status;
    if (oldStatus === status) {
        return res.json({ ok: true, appointment, message: 'Appointment status is already set to this value.' });
    }

    if (status === 'accepted') {
        if (!appointment.patientNumber) {
            appointment.patientNumber = await generatePatientNumber();
        }
        appointment.status = 'accepted';
        appointment.updatedAt = new Date().toISOString();
        appointment.payment = appointment.payment || { status: 'unpaid', amount: null, method: null, paidAt: null };
        
        await appointment.save();

        const whatsappResult = await sendAppointmentAccepted(appointment);
        if (!whatsappResult.ok) console.error(`[Appointment ${appointment.id}] Accepted WhatsApp failed.`);
        return res.json({ ok: true, appointment, whatsapp: whatsappResult.ok ? 'sent' : 'failed' });
    }

    if (status === 'cancelled') {
        appointment.status = 'cancelled';
        appointment.updatedAt = new Date().toISOString();
        await appointment.save();

        const whatsappResult = await sendAppointmentCancelled(appointment);
        if (!whatsappResult.ok) console.error(`[Appointment ${appointment.id}] Cancelled WhatsApp failed.`);
        return res.json({ ok: true, appointment, whatsapp: whatsappResult.ok ? 'sent' : 'failed' });
    }

    if (status === 'completed') {
        if (!appointment.patientNumber) return res.status(400).json({ ok: false, message: 'Patient number has not been assigned.' });
        if (!appointment.payment || appointment.payment.status !== 'paid') {
            return res.status(400).json({ ok: false, message: 'Payment must be marked as paid before completing the appointment.' });
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
    if (appointment.status !== 'accepted') return res.status(400).json({ ok: false, message: 'Payment can only be recorded for an accepted appointment.' });

    const amount = Number(req.body?.amount);
    const method = clean(req.body?.method, 20).toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, message: 'Please enter a valid payment amount.' });
    if (!['cash', 'upi'].includes(method)) return res.status(400).json({ ok: false, message: 'Please select Cash or UPI.' });

    appointment.payment = { status: 'paid', amount: amount, method: method, paidAt: new Date().toISOString() };
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
// FALLBACK
// ========================================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// START SERVER (UPDATED FOR VERCEL)
// ========================================
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Dr. P. N. Singh website running locally at http://localhost:${PORT}`);
    });
}

// Vercel requires the app to be exported!
module.exports = app;const express = require('express');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const mongoose = require('mongoose');

// ========================================
// 1. INITIALIZE APP FIRST (CRITICAL FIX)
// ========================================
const app = express();

// ========================================
// DATABASE CONNECTION (VERCEL OPTIMIZED)
// ========================================
const MONGODB_URI = process.env.MONGODB_URI || '';

async function connectToDatabase() {
    if (mongoose.connection.readyState === 1) {
        return;
    }
    try {
        console.log("Connecting to MongoDB Atlas...");
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000 // Timeout quickly if it fails instead of hanging
        });
        console.log("MongoDB Connected Successfully!");
    } catch (err) {
        console.error("Database connection error:", err);
        throw err;
    }
}

// Middleware to connect before API routes
app.use(async (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook')) {
        try {
            await connectToDatabase();
        } catch (err) {
            return res.status(500).json({ ok: false, message: 'Database connection failed on server.' });
        }
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
const WHATSAPP_ENABLED = String(process.env.WHATSAPP_ENABLED || 'true').toLowerCase() === 'true';
const CLINIC_WHATSAPP_NUMBER = process.env.CLINIC_WHATSAPP_NUMBER || '';
const CLINIC_UPI_ID = process.env.CLINIC_UPI_ID || '';
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
    _id: { type: String, default: 'global_counters' },
    nextAppointmentNumber: { type: Number, default: 1 },
    patientDate: { type: String, default: '' },
    nextPatientNumber: { type: Number, default: 1 }
});

const messageSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
    status: { type: String, default: 'new' },
    name: String,
    email: String,
    phone: String,
    message: String
});

const Appointment = mongoose.model('Appointment', appointmentSchema);
const Counter = mongoose.model('Counter', counterSchema);
const Message = mongoose.model('Message', messageSchema);

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
const formatDate = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value;
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
};
const todayString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// ========================================
// NUMBER GENERATORS (DATABASE BASED)
// ========================================
async function generateAppointmentNumber() {
    let counter = await Counter.findById('global_counters');
    if (!counter) {
        counter = await Counter.create({ _id: 'global_counters', nextAppointmentNumber: 1 });
    }
    const num = counter.nextAppointmentNumber || 1;
    counter.nextAppointmentNumber = num + 1;
    await counter.save();
    return String(num).padStart(7, '0');
}

async function generatePatientNumber() {
    let counter = await Counter.findById('global_counters');
    const today = todayString();
    
    if (!counter) {
        counter = await Counter.create({ _id: 'global_counters', patientDate: today, nextPatientNumber: 1 });
    }
    
    if (counter.patientDate !== today) {
        counter.patientDate = today;
        counter.nextPatientNumber = 1;
    }
    
    const num = counter.nextPatientNumber || 1;
    counter.nextPatientNumber = num + 1;
    await counter.save();
    return String(num).padStart(2, '0');
}

// ========================================
// WHATSAPP FUNCTIONS & INTERACTIVE BUTTONS
// ========================================
const whatsappConfigured = () => {
    return WHATSAPP_ENABLED && Boolean(WHATSAPP_ACCESS_TOKEN) && Boolean(WHATSAPP_PHONE_NUMBER_ID);
};

async function sendWhatsAppTemplate(phone, templateName, parameters) {
    if (!WHATSAPP_ENABLED) return { ok: false, skipped: true, reason: 'WhatsApp disabled.' };
    if (!WHATSAPP_ACCESS_TOKEN) return { ok: false, skipped: true, reason: 'WhatsApp access token missing.' };
    if (!WHATSAPP_PHONE_NUMBER_ID) return { ok: false, skipped: true, reason: 'WhatsApp phone number ID missing.' };

    const recipient = whatsappPhone(phone);
    if (!recipient || recipient.length < 10) return { ok: false, reason: 'Invalid recipient phone number.' };

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
        console.log(`[WhatsApp] Template "${templateName}" sent to ${recipient}`);
        return { ok: true, data };
    } catch (error) {
        console.error('[WhatsApp] Network/request error:', error);
        return { ok: false, error: error.message };
    }
}

// Helper to send raw WhatsApp interactive button payloads (Session Message)
async function sendWhatsAppInteractive(phone, messageBody, buttons) {
    if (!WHATSAPP_ENABLED) return { ok: false, skipped: true };
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
                    reply: { id: `btn_${index}_${Date.now()}`, title: btn.substring(0, 20) } // WhatsApp max title length is 20 chars
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
        if (!response.ok) {
            console.error('[WhatsApp] Interactive message error:', JSON.stringify(data, null, 2));
            return { ok: false, error: data };
        }
        return { ok: true, data };
    } catch (error) {
        console.error('[WhatsApp] Interactive network error:', error);
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
    // 1. Send the official approved template first
    const templateResult = await sendWhatsAppTemplate(appointment.phone, 'appointment_accepted', [
        appointment.name, formatDate(appointment.date), appointment.time, appointment.mode, appointment.patientNumber
    ]);

    // 2. Send your custom assistant message + 3 Interactive Buttons for ACCEPTED bookers
    const assistantMessage = `Hello Sir/Ma'am, I am your clinic's virtual assistant here to help guide you. Your appointment request has been accepted! Thank you for booking with Dr. P. N. Singh's clinic. Here is your confirmed patient number: *#${appointment.patientNumber}*.`;
    const buttons = ['📋 View Details', '📍 Clinic Location', '❓ FAQs'];
    
    await sendWhatsAppInteractive(appointment.phone, assistantMessage, buttons);
    return templateResult;
}

async function sendAppointmentCancelled(appointment) {
    // 1. Send the official approved cancellation template first
    const templateResult = await sendWhatsAppTemplate(appointment.phone, 'appointment_cancelled', [
        appointment.name, formatDate(appointment.date), appointment.time
    ]);

    // 2. Send your empathetic message + 3 Interactive Buttons for CANCELLED bookers
    const cancelMessage = `We are sorry to see your appointment had to be cancelled. If you need assistance or wish to plan for another day, please feel free to reach out to us.`;
    const buttons = ['📅 Pre-book Tomorrow', '📞 Contact Clinic', '❓ FAQs'];

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
        phone: '+91 00000 00000', email: 'clinic@example.com', whatsapp: '910000000000',
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

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ ok: false, message: 'Please choose a valid date.' });
    }
    const requestedDate = new Date(`${date}T00:00:00`);
    if (Number.isNaN(requestedDate.getTime())) {
        return res.status(400).json({ ok: false, message: 'Please choose a valid date.' });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (requestedDate < today) {
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

    if (!whatsappResult.ok) console.error(`[Appointment ${appointment.id}] Patient WhatsApp failed.`);
    if (!clinicWhatsappResult.ok) console.error(`[Appointment ${appointment.id}] Clinic WhatsApp failed.`);

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

    const oldStatus = appointment.status;
    if (oldStatus === status) {
        return res.json({ ok: true, appointment, message: 'Appointment status is already set to this value.' });
    }

    if (status === 'accepted') {
        if (!appointment.patientNumber) {
            appointment.patientNumber = await generatePatientNumber();
        }
        appointment.status = 'accepted';
        appointment.updatedAt = new Date().toISOString();
        appointment.payment = appointment.payment || { status: 'unpaid', amount: null, method: null, paidAt: null };
        
        await appointment.save();

        const whatsappResult = await sendAppointmentAccepted(appointment);
        if (!whatsappResult.ok) console.error(`[Appointment ${appointment.id}] Accepted WhatsApp failed.`);
        return res.json({ ok: true, appointment, whatsapp: whatsappResult.ok ? 'sent' : 'failed' });
    }

    if (status === 'cancelled') {
        appointment.status = 'cancelled';
        appointment.updatedAt = new Date().toISOString();
        await appointment.save();

        const whatsappResult = await sendAppointmentCancelled(appointment);
        if (!whatsappResult.ok) console.error(`[Appointment ${appointment.id}] Cancelled WhatsApp failed.`);
        return res.json({ ok: true, appointment, whatsapp: whatsappResult.ok ? 'sent' : 'failed' });
    }

    if (status === 'completed') {
        if (!appointment.patientNumber) return res.status(400).json({ ok: false, message: 'Patient number has not been assigned.' });
        if (!appointment.payment || appointment.payment.status !== 'paid') {
            return res.status(400).json({ ok: false, message: 'Payment must be marked as paid before completing the appointment.' });
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
    if (appointment.status !== 'accepted') return res.status(400).json({ ok: false, message: 'Payment can only be recorded for an accepted appointment.' });

    const amount = Number(req.body?.amount);
    const method = clean(req.body?.method, 20).toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, message: 'Please enter a valid payment amount.' });
    if (!['cash', 'upi'].includes(method)) return res.status(400).json({ ok: false, message: 'Please select Cash or UPI.' });

    appointment.payment = { status: 'paid', amount: amount, method: method, paidAt: new Date().toISOString() };
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
// WHATSAPP WEBHOOK ROUTES (JOURNEY 2)
// ========================================
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
            console.log('[Webhook] WEBHOOK_VERIFIED');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
});

app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;

        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    const value = change.value;
                    if (value && value.messages && value.messages.length > 0) {
                        const message = value.messages[0];
                        const senderPhone = message.from;

                        // Send direct inquiry welcome message + 3 buttons for direct messagers
                        const directMessage = `Hello Sir/Ma'am, I am your clinic's virtual assistant here to help you with inquiries, booking, and clinic information. How can we help you today?`;
                        const directButtons = ['📅 Book Appointment', '📍 Clinic Location', '💵 Fees & Timings'];

                        await sendWhatsAppInteractive(senderPhone, directMessage, directButtons);
                    }
                }
            }
            return res.status(200).send('EVENT_RECEIVED');
        }
        return res.sendStatus(404);
    } catch (error) {
        console.error('[Webhook] Error handling incoming message:', error);
        return res.sendStatus(500);
    }
});

// ========================================
// FALLBACK
// ========================================
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// START SERVER (UPDATED FOR VERCEL)
// ========================================
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Dr. P. N. Singh website running locally at http://localhost:${PORT}`);
    });
}

// Vercel requires the app to be exported!
module.exports = app;