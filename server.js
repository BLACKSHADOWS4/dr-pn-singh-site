// ============================================================================
// DR. P. N. SINGH CLINIC - COMPLETE BACKEND SERVER (server.js)
// ============================================================================

const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Environment Variables
const MONGODB_URI = process.env.MONGODB_URI;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TEMPLATE_CLINIC_ALERT = process.env.WHATSAPP_TEMPLATE_CLINIC_ALERT || 'clinic_new_appointment';
const ADMIN_KEY = process.env.ADMIN_KEY || 'drpnadmin123';
const PORT = process.env.PORT || 3000;

// Connect MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => console.log('[Database] Connected to MongoDB successfully.'))
    .catch(err => console.error('[Database Error]:', err));

// ============================================================================
// DATABASE SCHEMAS
// ============================================================================
const appointmentSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    appointmentNumber: { type: Number, required: true },
    createdAt: { type: String, required: true },
    status: { type: String, enum: ['new', 'accepted', 'completed', 'cancelled'], default: 'new' },
    patientNumber: { type: Number, default: null },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: '' },
    date: { type: String, required: true },
    time: { type: String, required: true },
    mode: { type: String, required: true },
    concern: { type: String, default: '' },
    payment: {
        status: { type: String, default: 'unpaid' },
        amount: { type: Number, default: null },
        method: { type: String, default: null },
        paidAt: { type: String, default: null }
    }
});

const Appointment = mongoose.model('Appointment', appointmentSchema);

const sessionSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    step: { type: String, default: 'idle' },
    lang: { type: String, default: 'en' },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now, expires: 300 } // 5 minutes TTL
});

const Session = mongoose.model('Session', sessionSchema);

// Counter Schema for Token Numbers
const counterSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

async function generateAppointmentNumber() {
    const counter = await Counter.findOneAndUpdate(
        { id: 'appointmentNumber' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
    );
    return counter.seq;
}

// ============================================================================
// HELPER UTILITIES & DATE FUNCTIONS
// ========================================
function clean(text, maxLen = 200) {
    if (!text) return '';
    return String(text).replace(/[<>]/g, '').trim().substring(0, maxLen);
}

function whatsappPhone(phone) {
    let p = String(phone || '').replace(/\D/g, '');
    if (p.length === 10) p = '91' + p;
    return p;
}

function todayString() {
    const d = new Date();
    return d.toISOString().split('T')[0];
}

function isValidISODate(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
    const d = new Date(dateString);
    return d instanceof Date && !isNaN(d) && d.toISOString().startsWith(dateString);
}

function normalizeDate(text) {
    const cleaned = String(text || '').trim();
    const currentToday = todayString();
    const [currYear, currMonth, currDay] = currentToday.split('-').map(Number);
    
    // 1. Just day number (e.g. "18" or "5")
    if (/^\d{1,2}$/.test(cleaned)) {
        let dayNum = Number(cleaned);
        let m = currMonth;
        let y = currYear;
        if (dayNum < currDay) {
            m += 1;
            if (m > 12) { m = 1; y += 1; }
        }
        const candidateDate = `${y}-${String(m).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        if (isValidISODate(candidateDate) && candidateDate >= currentToday) return candidateDate;
    }
    
    // 2. 8 digits without separators (DDMMYYYY)
    let digitsOnly = cleaned.replace(/\D/g, '');
    if (digitsOnly.length === 8) {
        let d = digitsOnly.substring(0, 2);
        let m = digitsOnly.substring(2, 4);
        let y = digitsOnly.substring(4, 8);
        let candidateDate = `${y}-${m}-${d}`;
        if (isValidISODate(candidateDate)) return candidateDate;
    }
    
    // 3. Formats with separators (DD-MM or MM-DD)
    const parts = cleaned.replace(/[\/\s.-]/g, '-').split('-').filter(Boolean);
    if (parts.length === 2) {
        let [p1, p2] = parts.map(Number);
        let y = currYear;
        let candidateDate = `${y}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
        if (isValidISODate(candidateDate) && candidateDate >= currentToday) return candidateDate;
        candidateDate = `${y}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
        if (isValidISODate(candidateDate) && candidateDate >= currentToday) return candidateDate;
    }
    
    // 4. Full date format (YYYY-MM-DD etc.)
    if (parts.length === 3) {
        let [p1, p2, p3] = parts;
        let y, m, d;
        if (p1.length === 4) { y = p1; m = p2; d = p3; }
        else if (p3.length === 4) { d = p1; m = p2; y = p3; }
        else if (p1.length === 2 && p3.length === 2) { d = p1; m = p2; y = '20' + p3; }
        
        if (y && m && d) {
            const formatted = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
            if (isValidISODate(formatted)) return formatted;
        }
    }
    return null;
}

function formatDate(isoStr) {
    if (!isoStr) return '';
    try {
        const d = new Date(isoStr);
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
        return isoStr;
    }
}

// ============================================================================
// WHATSAPP API SENDERS
// ============================================================================
async function sendWhatsAppText(to, text) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: whatsappPhone(to),
            type: 'text',
            text: { body: text }
        }, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('[WhatsApp Text Error]:', err.response?.data || err.message);
    }
}

async function sendWhatsAppInteractive(to, bodyText, options) {
    try {
        const buttons = options.map((opt, idx) => ({
            type: 'reply',
            reply: { id: `btn_${idx}`, title: opt.substring(0, 20) }
        }));

        await axios.post(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: whatsappPhone(to),
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: bodyText },
                action: { buttons }
            }
        }, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('[WhatsApp Interactive Error]:', err.response?.data || err.message);
    }
}

// Patient Confirmation receipt (No appointment number inside confirmation text)
async function sendAppointmentRequestReceived(appointment) {
    const msg = `✅ *Appointment Request Received!*\n\n• Date: ${formatDate(appointment.date)}\n• Time: ${appointment.time}\n• Mode: ${appointment.mode}\n\nThe clinic will review your request shortly.`;
    await sendWhatsAppText(appointment.phone, msg);
}

// 6-Variable Clinic Alert to Doctor / Reception
async function sendClinicNewAppointment(appointment) {
    const clinicNumber = process.env.CLINIC_ALERT_PHONE || '919876766533';
    try {
        await axios.post(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            messaging_product: 'whatsapp',
            to: whatsappPhone(clinicNumber),
            type: 'template',
            template: {
                name: WHATSAPP_TEMPLATE_CLINIC_ALERT,
                language: { code: 'en' },
                components: [
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: appointment.name || 'N/A' },
                            { type: 'text', text: appointment.phone || 'N/A' },
                            { type: 'text', text: formatDate(appointment.date) || 'N/A' },
                            { type: 'text', text: appointment.time || 'N/A' },
                            { type: 'text', text: appointment.mode || 'N/A' },
                            { type: 'text', text: appointment.concern || 'None provided' }
                        ]
                    }
                ]
            }
        }, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('[Clinic Alert Template Error]:', err.response?.data || err.message);
    }
}

// ============================================================================
// BILINGUAL BOT DICTIONARY (i18n)
// ============================================================================
const i18n = {
    en: {
        greeting: `Hello! I am Dr. P. N. Singh Clinic's virtual assistant. How can we assist you today?`,
        askName: `📅 *WhatsApp Appointment Booking*\n\nLet's get you scheduled! First, please reply with your *Full Name*:`,
        askDate: (name) => `Thank you, *${name}*! 📅\n\nPlease enter the date you want to book for your consultation (e.g., simply type the day number like *18*):`,
        askTime: `Got it. What preferred time slot would you like? (e.g., *11:00 AM* or *Evening*)`,
        askMode: `Please choose your consultation mode:\n\n1️⃣ *Clinic Visit*\n2️⃣ *Online Consultation*\n\n(Simply reply with *Clinic* or *Online*)`,
        askConcern: `Almost done! Do you have any specific health concern or symptoms to share?\n\n*(Type your concern or simply type *Skip* to bypass)*`,
        confirm: (appt) => `✅ *Appointment Request Submitted Successfully!*\n\n• *Date:* ${formatDate(appt.date)}\n• *Time:* ${appt.time}\n• *Mode:* ${appt.mode}\n\nThe clinic will confirm your appointment shortly. You will receive your confirmed patient token number here soon!`
    },
    hi: {
        greeting: `नमस्ते! मैं डॉ. पी. एन. सिंह क्लीनिक का वर्चुअल असिस्टेंट हूँ। आज हम आपकी कैसे मदद कर सकते हैं?`,
        askName: `📅 *व्हाट्सएप अपॉइंटमेंट बुकिंग*\n\nचलिए आपका अपॉइंटमेंट तय करते हैं! सबसे पहले, कृपया अपना *पूरा नाम* लिखकर भेजें:`,
        askDate: (name) => `धन्यवाद, *${name}*! 📅\n\nकृपया वह तारीख दर्ज करें जिस दिन आप कंसल्टेशन अपॉइंटमेंट बुक करना चाहते हैं (उदाहरण के लिए: केवल दिन का नंबर जैसे *18* लिखें):`,
        askTime: `समझ गया। आप कौन सा समय पसंद करेंगे? (उदाहरण: *11:00 AM* या *शाम*)`,
        askMode: `कृपया परामर्श का माध्यम चुनें:\n\n1️⃣ *क्लीनिक आकर*\n2️⃣ *ऑनलाइन परामर्श*\n\n(बस *क्लीनिक* या *ऑनलाइन* लिखकर भेजें)`,
        askConcern: `लगभग पूरा हो गया! क्या आपको अपनी किसी समस्या के बारे में बताना है?\n\n*(अपनी समस्या लिखें या इसे छोड़ने के लिए *Skip* लिखें)*`,
        confirm: (appt) => `✅ *अपॉइंटमेंट का अनुरोध सफलतापूर्वक हो गया!*\n\n• *तारीख:* ${formatDate(appt.date)}\n• *समय:* ${appt.time}\n• *माध्यम:* ${appt.mode}\n\nक्लीनिक जल्द ही आपके अपॉइंटमेंट की पुष्टि करेगा और आपको यहाँ टोकन नंबर भेज दिया जाएगा!`
    }
};

// ============================================================================
// WHATSAPP WEBHOOK ROUTE
// ============================================================================
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN || 'drpnclinic123')) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        if (body.object !== 'whatsapp_business_account') return res.sendStatus(404);

        for (const entry of body.entry || []) {
            for (const change of entry.changes || []) {
                const value = change.value;
                if (!value || !value.messages) continue;

                for (const message of value.messages) {
                    const senderPhone = message.from;
                    let session = await Session.findOne({ phone: senderPhone });
                    if (!session) {
                        session = await Session.create({ phone: senderPhone, step: 'idle', lang: 'en', data: {} });
                    }

                    const lang = session.lang || session.data?.lang || 'en';

                    // Handle Interactive Button replies
                    if (message.type === 'interactive' && message.interactive?.button_reply) {
                        const replyId = message.interactive.button_reply.id;
                        if (session.step === 'awaiting_language') {
                            const selectedLang = replyId === 'btn_1' ? 'hi' : 'en';
                            session.lang = selectedLang;
                            session.data.lang = selectedLang;
                            session.step = 'awaiting_name';
                            await session.save();
                            await sendWhatsAppText(senderPhone, i18n[selectedLang].askName);
                        }
                        continue;
                    }

                    // Handle Text Inputs
                    if (message.type === 'text') {
                        const userText = message.text.body.trim();
                        const isGreeting = ['hi', 'hii', 'hello', 'hey', 'नमस्ते'].includes(userText.toLowerCase());

                        if (isGreeting || session.step === 'idle') {
                            session.step = 'awaiting_language';
                            await session.save();
                            const langPrompt = `Welcome to Dr. P. N. Singh's Clinic! 🏥\n\nPlease choose your preferred language / कृपया अपनी पसंदीदा भाषा चुनें:`;
                            await sendWhatsAppInteractive(senderPhone, langPrompt, ['English', 'हिंदी']);
                        } 
                        else if (session.step === 'awaiting_language') {
                            const choice = userText.toLowerCase();
                            const selectedLang = (choice.includes('हिंदी') || choice.includes('hindi')) ? 'hi' : 'en';
                            session.lang = selectedLang;
                            session.data.lang = selectedLang;
                            session.step = 'awaiting_name';
                            await session.save();
                            await sendWhatsAppText(senderPhone, i18n[selectedLang].askName);
                        }
                        else if (session.step === 'awaiting_name') {
                            session.data.name = clean(userText, 100);
                            session.step = 'awaiting_date';
                            await session.save();
                            await sendWhatsAppText(senderPhone, i18n[lang].askDate(session.data.name));
                        } 
                        else if (session.step === 'awaiting_date') {
                            const parsedDate = normalizeDate(userText);
                            const currToday = todayString();
                            
                            // Strict validation for past or invalid dates with your requested exact prompt
                            if (!parsedDate || parsedDate < currToday) {
                                const errPrompt = lang === 'hi' 
                                    ? `❌ जो तारीख आप डाल रहे हैं वो गलत है या फिर वो डेट बीत चुका है। इस वजह से हम इस डेट में अपॉइंटमेंट नहीं ले सकते। कृपया कोई दूसरी वैध तारीख दर्ज करें:`
                                    : `❌ The date you entered is invalid or has already passed. We cannot accept appointments for past dates. Please enter another valid date:`;
                                await sendWhatsAppText(senderPhone, errPrompt);
                                return;
                            }

                            session.data.date = parsedDate;
                            session.step = 'awaiting_time';
                            await session.save();
                            await sendWhatsAppText(senderPhone, i18n[lang].askTime);
                        } 
                        else if (session.step === 'awaiting_time') {
                            let timeText = clean(userText, 20);
                            if (/^\d{1,2}$/.test(timeText)) {
                                timeText = timeText + ':00 AM';
                            }
                            session.data.time = timeText;
                            session.step = 'awaiting_mode';
                            await session.save();
                            await sendWhatsAppText(senderPhone, i18n[lang].askMode);
                        } 
                        else if (session.step === 'awaiting_mode') {
                            const text = userText.toLowerCase();
                            let selectedMode = 'Clinic Visit';

                            if (text.includes('2') || text.includes('online') || text.includes('ऑनलाइन')) {
                                selectedMode = 'Online Consultation';
                            } else if (text.includes('1') || text.includes('clinic') || text.includes('क्लीनिक') || text.includes('आकर')) {
                                selectedMode = 'Clinic Visit';
                            } else {
                                selectedMode = clean(userText, 30);
                            }

                            session.data.mode = selectedMode;
                            session.step = 'awaiting_concern';
                            await session.save();
                            await sendWhatsAppText(senderPhone, i18n[lang].askConcern);
                        } 
                        else if (session.step === 'awaiting_concern') {
                            const rawConcern = clean(userText, 500);
                            session.data.concern = (rawConcern.toLowerCase() === 'none' || rawConcern.toLowerCase() === 'skip') ? '' : rawConcern;
                            
                            const formattedPhone = whatsappPhone(senderPhone);

                            const existingActive = await Appointment.findOne({
                                phone: formattedPhone,
                                status: { $in: ['new', 'accepted'] }
                            });
                            if (existingActive) {
                                session.step = 'idle';
                                await session.save();
                                const dupMsg = lang === 'hi' 
                                    ? `❌ आपके इस नंबर पर पहले से ही एक एक्टिव अपॉइंटमेंट मौजूद है। कृपया पहले वाले के पूरा होने का इंतज़ार करें।`
                                    : `❌ You already have an active appointment request. Please wait for it to be processed.`;
                                await sendWhatsAppText(senderPhone, dupMsg);
                                return;
                            }

                            session.step = 'idle';
                            await session.save();

                            const appointmentNumber = await generateAppointmentNumber();

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
    } catch (error) {
        console.error('[Webhook Error]:', error);
        return res.sendStatus(500);
    }
});

// ============================================================================
// RECEPTIONIST DASHBOARD API ROUTES
// ============================================================================
app.get('/api/appointments', async (req, res) => {
    try {
        const { date, status } = req.query;
        let query = {};
        if (date) query.date = date;
        if (status) query.status = status;

        const appointments = await Appointment.find(query).sort({ appointmentNumber: -1 });
        res.json(appointments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/appointments/:id', async (req, res) => {
    try {
        const { status, patientNumber, payment } = req.body;
        const updateData = {};
        if (status) updateData.status = status;
        if (patientNumber !== undefined) updateData.patientNumber = patientNumber;
        if (payment) updateData.payment = payment;

        const updated = await Appointment.findOneAndUpdate({ id: req.params.id }, updateData, { new: true });
        if (!updated) return res.status(404).json({ error: 'Appointment not found' });
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/login', (req, res) => {
    const { key } = req.body;
    if (key === ADMIN_KEY) {
        return res.json({ success: true, token: 'authenticated' });
    }
    return res.status(401).json({ success: false, error: 'Invalid admin key' });
});

// Serve frontend static files
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
    console.log(`[Server] Dr. P. N. Singh Clinic server running on port ${PORT}`);
});
