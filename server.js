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

const sessionSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    step: { type: String, default: 'idle' },
    data: {
        name: String,
        date: String,
        time: String,
        mode: String,
        concern: String
    },
    updatedAt: { type: String, default: () => new Date().toISOString() }
});

const Appointment = mongoose.model('Appointment', appointmentSchema);
const Counter = mongoose.model('Counter', counterSchema);
const Message = mongoose.model('Message', messageSchema);
const Session = mongoose.model('Session', sessionSchema);

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
// NUMBER GENERATORS
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
        if (!appointment.patientNumber) {
            appointment.patientNumber = await generatePatientNumber();
        }
        appointment.status = 'accepted';
        appointment.updatedAt = new Date().toISOString();
        appointment.payment = appointment.payment || { status: 'unpaid', amount: null, method: null, paidAt: null };
        await appointment.save();

        const whatsappResult = await sendAppointmentAccepted(appointment);
        return res.json({ ok: true, appointment, whatsapp: whatsappResult.ok ? 'sent' : 'failed' });
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

                        // Find or initialize session for this phone number
                        let session = await Session.findOne({ phone: senderPhone });
                        if (!session) {
                            session = await Session.create({ phone: senderPhone, step: 'idle', data: {} });
                        }

                        // 1. Handle interactive button clicks
                        if (message.type === 'interactive' && message.interactive?.button_reply) {
                            const buttonTitle = message.interactive.button_reply.title || '';

                            if (buttonTitle.includes('Location')) {
                                const locationText = `📍 *Clinic Location*\n\nDr. P. N. Singh Clinic\nC-190, Bilandpur New Colony, Near Platinum MRI, Gorakhpur, Uttar Pradesh.\n\n🗺️ *Google Maps:* https://maps.google.com/?q=Bilandpur+Gorakhpur`;
                                await sendWhatsAppText(senderPhone, locationText);
                            } else if (buttonTitle.includes('FAQs')) {
                                const faqText = `❓ *Frequently Asked Questions*\n\n• *Consultation Fee:* ₹400\n• *Consultation Modes:* In-Clinic & Teleconsultation\n• *Timings:* Mon - Sat (10:00 AM - 07:00 PM)\n• *Reports:* Please carry any previous prescriptions or medical test records.`;
                                await sendWhatsAppText(senderPhone, faqText);
                            } else if (buttonTitle.includes('Details') || buttonTitle.includes('View')) {
                                const detailsText = `📋 *Appointment Guidance*\n\n• Please arrive 10 minutes prior to your selected consultation time.\n• Carry your token/patient number to show at the reception desk.\n• In case of rescheduling, please reach out directly.`;
                                await sendWhatsAppText(senderPhone, detailsText);
                            } else if (buttonTitle.includes('Fees') || buttonTitle.includes('Timings')) {
                                const feeText = `💵 *Fees & Consultation Timings*\n\n• *Doctor:* Dr. P. N. Singh (Neuropsychiatrist)\n• *Fee:* ₹400 per session\n• *Clinic Hours:* Monday to Saturday, 10:00 AM – 7:00 PM (Closed Sundays).`;
                                await sendWhatsAppText(senderPhone, feeText);
                            } else if (buttonTitle.includes('Book') || buttonTitle.includes('Pre-book')) {
                                // Start WhatsApp Booking Flow!
                                session.step = 'awaiting_name';
                                session.data = {};
                                await session.save();
                                await sendWhatsAppText(senderPhone, `📅 *WhatsApp Appointment Booking*\n\nLet's get you scheduled! First, please reply with your **Full Name**:`);
                            } else if (buttonTitle.includes('Contact')) {
                                const contactText = `📞 *Clinic Contact*\n\n• Clinic Desk: Available during OPD hours\n• Address: Bilandpur New Colony, Gorakhpur\n• Online Portal: https://drpnsingh.vercel.app/`;
                                await sendWhatsAppText(senderPhone, contactText);
                            }
                        }
                        // 2. Handle Conversational Text Inputs based on Session State
                        else if (message.type === 'text') {
                            const userText = message.text.body.trim();

                            if (session.step === 'awaiting_name') {
                                session.data.name = clean(userText, 100);
                                session.step = 'awaiting_date';
                                await session.save();
                                await sendWhatsAppText(senderPhone, `Thank you, *${session.data.name}*.\n\nNow, what date would you like to book? (Please enter in format: *YYYY-MM-DD*, e.g., 2026-09-01)`);
                            } 
                            else if (session.step === 'awaiting_date') {
                                session.data.date = clean(userText, 10);
                                session.step = 'awaiting_time';
                                await session.save();
                                await sendWhatsAppText(senderPhone, `Got it. What preferred time slot would you like? (e.g., *11:00 AM* or *Evening*)`);
                            } 
                            else if (session.step === 'awaiting_time') {
                                session.data.time = clean(userText, 20);
                                session.step = 'awaiting_mode';
                                await session.save();
                                await sendWhatsAppText(senderPhone, `Please choose your consultation mode:\n\n1️⃣ *Clinic Visit*\n2️⃣ *Online Consultation*\n\n(Simply reply with *Clinic* or *Online*)`);
                            } 
                            else if (session.step === 'awaiting_mode') {
                                session.data.mode = clean(userText, 30);
                                session.step = 'awaiting_concern';
                                await session.save();
                                await sendWhatsAppText(senderPhone, `Almost done! Do you have any specific health concern or symptoms to share? \n\n*(Type your concern or simply type **None** or **Skip** to bypass)*`);
                            } 
                            else if (session.step === 'awaiting_concern') {
                                const rawConcern = clean(userText, 500);
                                session.data.concern = (rawConcern.toLowerCase() === 'none' || rawConcern.toLowerCase() === 'skip') ? '' : rawConcern;
                                session.step = 'idle';
                                await session.save();

                                // Finalize and create appointment in database!
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

                                // Fire Notifications (Patient confirmation + Clinic alert)
                                await sendAppointmentRequestReceived(appointment);
                                await sendClinicNewAppointment(appointment);

                                await sendWhatsAppText(senderPhone, `✅ *Appointment Request Submitted Successfully!*\n\n• *Appointment No:* #${appointment.appointmentNumber}\n• *Date:* ${formatDate(appointment.date)}\n• *Time:* ${appointment.time}\n• *Mode:* ${appointment.mode}\n\nThe clinic will review and confirm your appointment shortly. You will receive a confirmation message with your token number here!`);
                            } 
                            else {
                                // Default greeting if idle
                                const greeting = `Hello! I am Dr. P. N. Singh Clinic's virtual assistant. How can we assist you today?`;
                                const menuButtons = ['📅 Book Appointment', '📍 Clinic Location', '💵 Fees & Timings'];
                                await sendWhatsAppInteractive(senderPhone, greeting, menuButtons);
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