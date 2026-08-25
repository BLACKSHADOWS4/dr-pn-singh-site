const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('dotenv').config();

const app = express();


// ========================================
// SERVER CONFIGURATION
// ========================================

const PORT = Number(process.env.PORT || 3000);

const ADMIN_KEY =
    process.env.ADMIN_KEY || 'change-this-admin-key';


// ========================================
// WHATSAPP CONFIGURATION
// ========================================

const WHATSAPP_ACCESS_TOKEN =
    process.env.WHATSAPP_ACCESS_TOKEN || '';

const WHATSAPP_PHONE_NUMBER_ID =
    process.env.WHATSAPP_PHONE_NUMBER_ID || '';

const WHATSAPP_API_VERSION =
    process.env.WHATSAPP_API_VERSION || 'v25.0';

const WHATSAPP_ENABLED =
    String(process.env.WHATSAPP_ENABLED || 'true').toLowerCase() === 'true';

// ========================================
// CLINIC WHATSAPP CONFIGURATION
// ========================================

const CLINIC_WHATSAPP_NUMBER =
    process.env.CLINIC_WHATSAPP_NUMBER || '';


// ========================================
// WHATSAPP TEMPLATE NAMES
// ========================================

const WA_TEMPLATE_REQUEST_RECEIVED =
    process.env.WHATSAPP_TEMPLATE_REQUEST_RECEIVED ||
    'appointment_request_received';

const WA_TEMPLATE_CLINIC_NEW_APPOINTMENT =
    process.env.WHATSAPP_TEMPLATE_CLINIC_ALERT ||
    'clinic_new_appointment';

const WA_TEMPLATE_ACCEPTED =
    process.env.WHATSAPP_TEMPLATE_ACCEPTED ||
    'appointment_accepted';

const WA_TEMPLATE_CANCELLED =
    process.env.WHATSAPP_TEMPLATE_CANCELLED ||
    'appointment_cancelled';

const WA_TEMPLATE_LANGUAGE =
    process.env.WHATSAPP_TEMPLATE_LANGUAGE ||
    'en_US';


// ========================================
// DATA FILES
// ========================================

const DATA = path.join(__dirname, 'data');

const AF = path.join(DATA, 'appointments.json');
const MF = path.join(DATA, 'messages.json');

fs.mkdirSync(DATA, { recursive: true });

for (const file of [AF, MF]) {

    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '[]');
    }

}


// ========================================
// MIDDLEWARE
// ========================================

app.use(
    express.json({
        limit: '100kb'
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    express.static(
        path.join(__dirname, 'public')
    )
);


// ========================================
// HELPERS
// ========================================

const read = file => {

    try {

        return JSON.parse(
            fs.readFileSync(file, 'utf8')
        );

    } catch {

        return [];

    }

};


const write = (file, data) => {

    const tempFile = file + '.tmp';

    fs.writeFileSync(
        tempFile,
        JSON.stringify(data, null, 2)
    );

    fs.renameSync(
        tempFile,
        file
    );

};


const clean = (value, max = 500) =>
    String(value ?? '')
        .trim()
        .slice(0, max);


// ========================================
// EMAIL VALIDATION
// ========================================

const email = value =>
    !value ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);


// ========================================
// INDIAN MOBILE VALIDATION
// ========================================

const indianMobile = value => {

    const cleaned = String(value ?? '')
        .replace(/[\s-]/g, '');

    return /^(?:\+91|91)?[6-9]\d{9}$/.test(
        cleaned
    );

};


// ========================================
// FORMAT PHONE FOR WHATSAPP API
// ========================================

const whatsappPhone = value => {

    const cleaned = String(value ?? '')
        .replace(/\D/g, '');

    if (cleaned.length === 10) {
        return '91' + cleaned;
    }

    if (
        cleaned.length === 12 &&
        cleaned.startsWith('91')
    ) {
        return cleaned;
    }

    return cleaned;

};


// ========================================
// FORMAT APPOINTMENT DATE
// ========================================

const formatDate = value => {

    const match =
        /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
        return value;
    }

    const [, year, month, day] = match;

    const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day)
    );

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString(
        'en-IN',
        {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }
    );

};


// ========================================
// WHATSAPP CONFIG CHECK
// ========================================

const whatsappConfigured = () => {

    return (
        WHATSAPP_ENABLED &&
        Boolean(WHATSAPP_ACCESS_TOKEN) &&
        Boolean(WHATSAPP_PHONE_NUMBER_ID)
    );

};


// ========================================
// SEND WHATSAPP TEMPLATE
// ========================================

async function sendWhatsAppTemplate(
    phone,
    templateName,
    parameters
) {

    if (!WHATSAPP_ENABLED) {

        console.log(
            '[WhatsApp] Disabled by WHATSAPP_ENABLED.'
        );

        return {
            ok: false,
            skipped: true,
            reason: 'WhatsApp disabled.'
        };

    }


    if (!WHATSAPP_ACCESS_TOKEN) {

        console.error(
            '[WhatsApp] WHATSAPP_ACCESS_TOKEN is missing.'
        );

        return {
            ok: false,
            skipped: true,
            reason: 'WhatsApp access token missing.'
        };

    }


    if (!WHATSAPP_PHONE_NUMBER_ID) {

        console.error(
            '[WhatsApp] WHATSAPP_PHONE_NUMBER_ID is missing.'
        );

        return {
            ok: false,
            skipped: true,
            reason: 'WhatsApp phone number ID missing.'
        };

    }


    const recipient = whatsappPhone(phone);


    if (
        !recipient ||
        recipient.length < 10
    ) {

        console.error(
            '[WhatsApp] Invalid recipient number:',
            phone
        );

        return {
            ok: false,
            reason: 'Invalid recipient phone number.'
        };

    }


    const url =
        `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;


    const body = {

        messaging_product: 'whatsapp',

        to: recipient,

        type: 'template',

        template: {

            name: templateName,

            language: {
                code: WA_TEMPLATE_LANGUAGE
            },

            components: [

                {
                    type: 'body',

                    parameters:
                        parameters.map(value => ({
                            type: 'text',
                            text: String(value ?? '')
                        }))

                }

            ]

        }

    };


    try {

        const response = await fetch(
            url,
            {
                method: 'POST',

                headers: {

                    'Authorization':
                        `Bearer ${WHATSAPP_ACCESS_TOKEN}`,

                    'Content-Type':
                        'application/json'

                },

                body:
                    JSON.stringify(body)

            }
        );


        const data =
            await response.json();


        if (!response.ok) {

            console.error(
                '[WhatsApp] API error:',
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );

            return {

                ok: false,

                status: response.status,

                error: data

            };

        }


        console.log(
            `[WhatsApp] Template "${templateName}" sent to ${recipient}`
        );


        return {

            ok: true,

            data

        };

    } catch (error) {

        console.error(
            '[WhatsApp] Network/request error:',
            error
        );

        return {

            ok: false,

            error: error.message

        };

    }

}


// ========================================
// APPOINTMENT — REQUEST RECEIVED
// ========================================

async function sendAppointmentRequestReceived(
    appointment
) {

    return sendWhatsAppTemplate(

        appointment.phone,

        WA_TEMPLATE_REQUEST_RECEIVED,

        [

            appointment.name,

            formatDate(appointment.date),

            appointment.time,

            appointment.mode

        ]

    );

}


// ========================================
// CLINIC — NEW APPOINTMENT ALERT
// ========================================

async function sendClinicNewAppointment(
    appointment
) {

    if (!CLINIC_WHATSAPP_NUMBER) {

        console.error(
            '[WhatsApp] CLINIC_WHATSAPP_NUMBER is missing.'
        );

        return {
            ok: false,
            reason: 'Clinic WhatsApp number missing.'
        };

    }


    return sendWhatsAppTemplate(

        CLINIC_WHATSAPP_NUMBER,

        WA_TEMPLATE_CLINIC_NEW_APPOINTMENT,

        [

            appointment.id,

            formatDate(appointment.date),

            appointment.time,

            appointment.mode,

            appointment.concern || 'Not provided'

        ]

    );

}


// ========================================
// APPOINTMENT — ACCEPTED
// ========================================

async function sendAppointmentAccepted(
    appointment
) {

    return sendWhatsAppTemplate(

        appointment.phone,

        WA_TEMPLATE_ACCEPTED,

        [

            appointment.name,

            formatDate(appointment.date),

            appointment.time,

            appointment.mode

        ]

    );

}


// ========================================
// APPOINTMENT — CANCELLED
// ========================================

async function sendAppointmentCancelled(
    appointment
) {

    return sendWhatsAppTemplate(

        appointment.phone,

        WA_TEMPLATE_CANCELLED,

        [

            appointment.name,

            formatDate(appointment.date),

            appointment.time

        ]

    );

}


// ========================================
// HEALTH
// ========================================

app.get(
    '/api/health',
    (req, res) => {

        res.json({

            ok: true,

            service:
                'Dr. P. N. Singh Clinic',

            time:
                new Date().toISOString(),

            whatsapp:
                whatsappConfigured()
                    ? 'configured'
                    : 'not configured'

        });

    }
);


// ========================================
// CLINIC INFORMATION
// ========================================

app.get(
    '/api/clinic',
    (req, res) => {

        res.json({

            doctor:
                'Dr. P. N. Singh',

            specialty:
                'Neuropsychiatrist',

            tagline:
                'Better Mental Health, Better Quality of Life.',

            consultationFee:
                400,

            address:
                'C-190, Bilandpur New Colony, Near Platinum MRI, Gorakhpur, Uttar Pradesh',

            phone:
                '+91 00000 00000',

            email:
                'clinic@example.com',

            whatsapp:
                '910000000000'

        });

    }
);


// ========================================
// REVIEWS
// ========================================

app.get(
    '/api/reviews',
    (req, res) => {

        res.json([]);

    }
);


// ========================================
// APPOINTMENTS
// ========================================

app.post(
    '/api/appointments',
    async (req, res) => {

        const b = req.body || {};


        const name =
            clean(b.name, 100);

        const phone =
            clean(b.phone, 30);

        const mail =
            clean(b.email, 120);

        const date =
            clean(b.date, 10);

        const time =
            clean(b.time, 20);

        const mode =
            clean(b.mode, 30);

        const concern =
            clean(b.concern, 500);


        // ====================================
        // REQUIRED FIELDS
        // ====================================

        if (
            !name ||
            !phone ||
            !date ||
            !time ||
            !mode
        ) {

            return res.status(400).json({

                ok: false,

                message:
                    'Please complete name, phone, date, time and consultation mode.'

            });

        }


        // ====================================
        // PHONE VALIDATION
        // ====================================

        if (!indianMobile(phone)) {

            return res.status(400).json({

                ok: false,

                message:
                    'Please enter a valid 10-digit Indian mobile number.'

            });

        }


        // ====================================
        // DATE FORMAT VALIDATION
        // ====================================

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(date)
        ) {

            return res.status(400).json({

                ok: false,

                message:
                    'Please choose a valid date.'

            });

        }


        // ====================================
        // ACTUAL DATE VALIDATION
        // ====================================

        const requestedDate =
            new Date(`${date}T00:00:00`);

        if (
            Number.isNaN(
                requestedDate.getTime()
            )
        ) {

            return res.status(400).json({

                ok: false,

                message:
                    'Please choose a valid date.'

            });

        }


        // ====================================
        // PAST DATE VALIDATION
        // ====================================

        const today =
            new Date();

        today.setHours(
            0,
            0,
            0,
            0
        );

        if (requestedDate < today) {

            return res.status(400).json({

                ok: false,

                message:
                    'Please choose today or a future date.'

            });

        }


        // ====================================
        // EMAIL VALIDATION
        // ====================================

        if (!email(mail)) {

            return res.status(400).json({

                ok: false,

                message:
                    'Please enter a valid email address.'

            });

        }


        // ====================================
        // CREATE APPOINTMENT
        // ====================================

        const appointment = {

            id:
                crypto.randomUUID(),

            createdAt:
                new Date().toISOString(),

            status:
                'new',

            name,

            phone,

            email:
                mail,

            date,

            time,

            mode,

            concern

        };


        // ====================================
        // SAVE APPOINTMENT
        // ====================================

        const appointments =
            read(AF);

        appointments.push(
            appointment
        );

        write(
            AF,
            appointments
        );


        // ====================================
        // WHATSAPP — REQUEST RECEIVED
        // ====================================

        const whatsappResult =
            await sendAppointmentRequestReceived(
                appointment
            );


        // ====================================
        // WHATSAPP — CLINIC NEW APPOINTMENT
        // ====================================

        const clinicWhatsappResult =
            await sendClinicNewAppointment(
                appointment
            );

        
        // ====================================
        // LOG WHATSAPP RESULT
        // ====================================

        if (!whatsappResult.ok) {

            console.error(
                `[Appointment ${appointment.id}] WhatsApp request-received notification failed.`
            );

        }


        // ====================================
        // LOG CLINIC WHATSAPP RESULT
        // ====================================

        if (!clinicWhatsappResult.ok) {

            console.error(
                `[Appointment ${appointment.id}] Clinic WhatsApp notification failed.`
            );

        }


        // ====================================
        // RESPONSE
        // ====================================

        res.status(201).json({

            ok: true,

            message:
                'Your appointment request has been received. The clinic will confirm the appointment.',

            appointmentId:
                appointment.id,

            whatsapp: {
                patient:
                    whatsappResult.ok
                        ? 'sent'
                        : 'failed',

                clinic:
                    clinicWhatsappResult.ok
                        ? 'sent'
                        : 'failed'
            }
        });

    }
);


// ========================================
// CONTACT FORM
// ========================================

app.post(
    '/api/contact',
    (req, res) => {

        const b =
            req.body || {};


        const name =
            clean(b.name, 100);

        const mail =
            clean(b.email, 120);

        const phone =
            clean(b.phone, 30);

        const message =
            clean(
                b.message,
                1500
            );


        if (
            !name ||
            (!mail && !phone) ||
            !message
        ) {

            return res.status(400).json({

                ok: false,

                message:
                    'Please provide your name, one contact method and your message.'

            });

        }


        if (!email(mail)) {

            return res.status(400).json({

                ok: false,

                message:
                    'Please enter a valid email address.'

            });

        }


        const contactMessage = {

            id:
                crypto.randomUUID(),

            createdAt:
                new Date().toISOString(),

            status:
                'new',

            name,

            email:
                mail,

            phone,

            message

        };


        const messages =
            read(MF);

        messages.push(
            contactMessage
        );

        write(
            MF,
            messages
        );


        res.status(201).json({

            ok: true,

            message:
                'Your message has been received. The clinic will get back to you.'

        });

    }
);


// ========================================
// ADMIN AUTHENTICATION
// ========================================

function admin(
    req,
    res,
    next
) {

    const key =
        req.get('x-admin-key') ||
        req.query.key;


    if (
        key !== ADMIN_KEY
    ) {

        return res.status(401).json({

            ok: false,

            message:
                'Unauthorized.'

        });

    }


    next();

}


// ========================================
// ADMIN — APPOINTMENTS
// ========================================

app.get(
    '/api/admin/appointments',
    admin,
    (req, res) => {

        res.json({

            ok: true,

            appointments:
                read(AF)

        });

    }
);


// ========================================
// ADMIN — UPDATE APPOINTMENT STATUS
// ========================================

app.patch(
    '/api/admin/appointments/:id',
    admin,
    async (req, res) => {

        const appointments =
            read(AF);


        const appointment =
            appointments.find(
                item =>
                    item.id ===
                    req.params.id
            );


        const status =
            clean(
                req.body?.status,
                30
            );


        // ====================================
        // APPOINTMENT NOT FOUND
        // ====================================

        if (!appointment) {

            return res.status(404).json({

                ok: false,

                message:
                    'Appointment not found.'

            });

        }


        // ====================================
        // VALID STATUS
        // ====================================

        if (
            ![
                'new',
                'accepted',
                'completed',
                'cancelled'
            ].includes(status)
        ) {

            return res.status(400).json({

                ok: false,

                message:
                    'Invalid appointment status.'

            });

        }


        // ====================================
        // PREVENT DUPLICATE STATUS ACTION
        // ====================================

        const oldStatus =
            appointment.status;


        if (
            oldStatus === status
        ) {

            return res.json({

                ok: true,

                appointment,

                message:
                    'Appointment status is already set to this value.'

            });

        }


        // ====================================
        // UPDATE STATUS
        // ====================================

        appointment.status =
            status;

        appointment.updatedAt =
            new Date().toISOString();


        // ====================================
        // SAVE FIRST
        // ====================================

        write(
            AF,
            appointments
        );


        // ====================================
        // WHATSAPP STATUS NOTIFICATION
        // ====================================

        let whatsappResult =
            null;


        // ====================================
        // ACCEPTED
        // ====================================

        if (
            status === 'accepted'
        ) {

            whatsappResult =
                await sendAppointmentAccepted(
                    appointment
                );

        }


        // ====================================
        // CANCELLED
        // ====================================

        if (
            status === 'cancelled'
        ) {

            whatsappResult =
                await sendAppointmentCancelled(
                    appointment
                );

        }


        // ====================================
        // COMPLETED
        // ====================================

        if (
            status === 'completed'
        ) {

            console.log(
                `[Appointment ${appointment.id}] Appointment marked completed.`
            );

        }


        // ====================================
        // LOG NOTIFICATION FAILURE
        // ====================================

        if (
            whatsappResult &&
            !whatsappResult.ok
        ) {

            console.error(

                `[Appointment ${appointment.id}] WhatsApp status notification failed.`

            );

        }


        // ====================================
        // RESPONSE
        // ====================================

        res.json({

            ok: true,

            appointment,

            whatsapp:
                whatsappResult
                    ? (
                        whatsappResult.ok
                            ? 'sent'
                            : 'failed'
                    )
                    : 'not_required'

        });

    }
);


// ========================================
// ADMIN — MESSAGES
// ========================================

app.get(
    '/api/admin/messages',
    admin,
    (req, res) => {

        res.json({

            ok: true,

            messages:
                read(MF)

        });

    }
);


// ========================================
// FALLBACK
// ========================================

app.use(
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                'public',
                'index.html'
            )
        );

    }
);


// ========================================
// START SERVER
// ========================================

app.listen(
    PORT,
    () => {

        console.log(
            `Dr. P. N. Singh website running at http://localhost:${PORT}`
        );

        console.log(
            `[WhatsApp] Enabled: ${WHATSAPP_ENABLED}`
        );

        console.log(
            `[WhatsApp] Phone Number ID configured: ${Boolean(WHATSAPP_PHONE_NUMBER_ID)}`
        );

        console.log(
            `[WhatsApp] Access Token configured: ${Boolean(WHATSAPP_ACCESS_TOKEN)}`
        );

    }
);