// ================================
// MOBILE MENU
// ================================

const menuBtn = document.getElementById('menuBtn');
const mobileMenu = document.getElementById('mobileMenu');

menuBtn?.addEventListener('click', () => {
    mobileMenu?.classList.toggle('open');
});

mobileMenu?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        mobileMenu?.classList.remove('open');
    });
});


// ================================
// DATE VALIDATION
// ================================

const dateInputs = document.querySelectorAll('input[name="date"]');

dateInputs.forEach(dateInput => {
    const today = new Date();
    const localDate = new Date(
        today.getTime() - today.getTimezoneOffset() * 60000
    );

    dateInput.min = localDate.toISOString().slice(0, 10);
});


// ================================
// PHONE VALIDATION
// ================================

function isValidIndianMobile(phone) {
    const cleaned = phone.replace(/[\s-]/g, '');

    return /^(?:\+91|91)?[6-9]\d{9}$/.test(cleaned);
}


// ================================
// COMMON FORM SUBMISSION
// ================================

async function submitForm(form, endpoint, statusEl) {

    statusEl.className = 'form-status';
    statusEl.textContent = '';

    // Phone validation
    const phoneInput = form.querySelector('input[name="phone"]');

    if (phoneInput && !isValidIndianMobile(phoneInput.value)) {
        statusEl.className = 'form-status error';
        statusEl.textContent =
            'Please enter a valid 10-digit Indian mobile number.';

        phoneInput.focus();

        return null;
    }

    statusEl.textContent = 'Sending…';

    try {

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(
                Object.fromEntries(new FormData(form))
            )
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.message || 'Something went wrong.'
            );
        }

        statusEl.className = 'form-status success';
        statusEl.textContent = data.message;

        return data;

    } catch (error) {

        statusEl.className = 'form-status error';
        statusEl.textContent = error.message;

        return null;
    }
}


// ================================
// MAIN APPOINTMENT FORM
// ================================

const form = document.getElementById('appointmentForm');
const status = document.getElementById('appointmentStatus');

const modal = document.getElementById('successModal');
const modalText = document.getElementById('modalText');

form?.addEventListener('submit', async event => {

    event.preventDefault();

    // Browser required-field validation
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const data = await submitForm(
        form,
        '/api/appointments',
        status
    );

    if (data?.ok) {

        modalText.textContent = data.message;
        modal.classList.add('open');

        form.reset();
    }
});


// ================================
// SUCCESS MODAL
// ================================

function closeModal() {
    modal?.classList.remove('open');
}

document
    .getElementById('modalClose')
    ?.addEventListener('click', closeModal);

document
    .getElementById('modalOk')
    ?.addEventListener('click', closeModal);

modal?.addEventListener('click', event => {

    if (event.target === modal) {
        closeModal();
    }
});


// ================================
// FLOATING APPOINTMENT MODAL
// ================================

const appointmentModal =
    document.getElementById('appointmentModal');

const openAppointmentModal =
    document.getElementById('openAppointmentModal');

const appointmentModalClose =
    document.getElementById('appointmentModalClose');

const appointmentModalForm =
    document.getElementById('appointmentModalForm');

const appointmentModalStatus =
    document.getElementById('appointmentModalStatus');


// Open floating appointment modal
openAppointmentModal?.addEventListener('click', event => {

    event.preventDefault();

    appointmentModal?.classList.add('open');
});


// Close floating appointment modal
appointmentModalClose?.addEventListener('click', () => {

    appointmentModal?.classList.remove('open');
});


// Close when clicking outside the box
appointmentModal?.addEventListener('click', event => {

    if (event.target === appointmentModal) {
        appointmentModal.classList.remove('open');
    }
});


// ================================
// FLOATING APPOINTMENT FORM
// ================================

appointmentModalForm?.addEventListener(
    'submit',
    async event => {

        event.preventDefault();

        // Browser required-field validation
        if (!appointmentModalForm.checkValidity()) {
            appointmentModalForm.reportValidity();
            return;
        }

        const data = await submitForm(
            appointmentModalForm,
            '/api/appointments',
            appointmentModalStatus
        );

        if (data?.ok) {

            appointmentModalForm.reset();

            appointmentModal.classList.remove('open');

            modalText.textContent = data.message;
            modal.classList.add('open');
        }
    }
);