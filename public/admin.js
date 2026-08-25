(() => {
	'use strict';

	const state = { appointments: [], selected: null };
	const $ = selector => document.querySelector(selector);
	const adminKey = () => sessionStorage.getItem('clinicAdminKey') || '';
	const today = () => new Date().toISOString().slice(0, 10);

	async function request(url, options = {}) {
		const response = await fetch(url, { cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey(), ...(options.headers || {}) } });
		const data = await response.json().catch(() => ({}));
		if (response.status === 401) { sessionStorage.removeItem('clinicAdminKey'); showLogin('The admin key is invalid or has expired.'); throw new Error('Authentication required.'); }
		if (!response.ok) throw new Error(data.message || 'The request could not be completed.');
		return data;
	}

	function escapeHtml(value) {
		return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
	}
	function formatDate(date) { if (!date) return '—'; return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
	function formatStatus(appointment) { return appointment.payment?.status === 'paid' && appointment.status === 'accepted' ? 'paid' : appointment.status; }
	function statusBadge(appointment) { const status = formatStatus(appointment); return `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`; }

	function renderMetrics() {
		const appointments = state.appointments;
		$('#newCount').textContent = appointments.filter(item => item.status === 'new').length;
		$('#acceptedCount').textContent = appointments.filter(item => item.status === 'accepted').length;
		$('#todayCount').textContent = appointments.filter(item => item.date === today()).length;
		$('#completedCount').textContent = appointments.filter(item => item.status === 'completed').length;
	}

	function renderTable() {
		const query = $('#searchInput').value.trim().toLowerCase();
		const appointments = state.appointments.filter(item => !query || String(item.appointmentNumber).toLowerCase().includes(query));
		$('#appointmentCount').textContent = `${appointments.length} appointment${appointments.length === 1 ? '' : 's'}`;
		if (!appointments.length) { $('#appointmentsBody').innerHTML = `<tr><td class="table-state" colspan="9">${query ? 'No appointment matches that ID.' : 'No appointments yet.'}</td></tr>`; return; }
		$('#appointmentsBody').innerHTML = appointments.map(appointment => `<tr>
			<td class="id-cell">${escapeHtml(appointment.appointmentNumber)}</td>
			<td>${escapeHtml(appointment.patientNumber || '—')}</td>
			<td class="patient-cell"><strong>${escapeHtml(appointment.name)}</strong></td>
			<td>${escapeHtml(appointment.phone)}</td>
			<td class="date-cell">${formatDate(appointment.date)}<br><small>${escapeHtml(appointment.time)}</small></td>
			<td><span class="mode">${escapeHtml(appointment.mode)}</span></td>
			<td>${statusBadge(appointment)}</td><td class="email-cell">${escapeHtml(appointment.email || '—')}</td>
			<td><button class="open-button" data-id="${escapeHtml(appointment.id)}" type="button">Open</button></td></tr>`).join('');
	}

	async function loadAppointments(showLoading = false) {
		if (showLoading) $('#appointmentsBody').innerHTML = '<tr><td class="table-state" colspan="10"><span class="loader"></span>Loading appointments...</td></tr>';
		$('#syncText').textContent = 'Syncing'; $('.status-dot').classList.add('busy');
		try { const data = await request('/api/admin/appointments'); state.appointments = data.appointments || []; renderMetrics(); renderTable(); $('#syncText').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; }
		catch (error) { showToast(error.message, true); $('#syncText').textContent = 'Sync failed'; }
		finally { $('.status-dot').classList.remove('busy'); }
	}

	function openModal(appointment) {
		state.selected = appointment;
		const isNew = appointment.status === 'new'; const isAccepted = appointment.status === 'accepted'; const paid = appointment.payment?.status === 'paid';
		$('#modalContent').innerHTML = `<p class="eyebrow">Appointment ${escapeHtml(appointment.appointmentNumber)}</p><h2 id="modalTitle">${escapeHtml(appointment.name)}</h2><p class="modal-subtitle">Submitted ${new Date(appointment.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
			<div class="detail-grid"><div class="detail-item"><label>Patient number</label><p>${escapeHtml(appointment.patientNumber || 'Assigned after acceptance')}</p></div><div class="detail-item"><label>Patient name</label><p>${escapeHtml(appointment.name)}</p></div><div class="detail-item"><label>Status</label><p>${statusBadge(appointment)}</p></div><div class="detail-item"><label>Phone</label><p>${escapeHtml(appointment.phone)}</p></div><div class="detail-item"><label>Email</label><p>${escapeHtml(appointment.email || 'Not provided')}</p></div><div class="detail-item"><label>Date & time</label><p>${formatDate(appointment.date)} at ${escapeHtml(appointment.time)}</p></div><div class="detail-item"><label>Mode</label><p>${escapeHtml(appointment.mode)}</p></div>${paid ? `<div class="detail-item"><label>Payment</label><p>₹${escapeHtml(appointment.payment.amount)} · ${escapeHtml(appointment.payment.method.toUpperCase())}</p></div>` : ''}</div>
			<div class="modal-actions">${isNew ? '<button class="button action-primary" data-action="accept" type="button">Accept appointment</button><button class="button action-danger" data-action="cancel" type="button">Cancel request</button>' : ''}${isAccepted && !paid ? '<button class="button action-primary" data-action="payment" type="button">Record payment</button>' : ''}${isAccepted && paid ? '<button class="button action-muted" data-action="complete" type="button">Mark completed</button>' : ''}${appointment.status === 'cancelled' ? '<span class="modal-subtitle">This request was cancelled.</span>' : ''}</div>${isAccepted && !paid ? '<div id="paymentArea"></div>' : ''}`;
		$('#modalBackdrop').hidden = false;
	}

	async function showPaymentForm() {
		$('#paymentArea').innerHTML = `<div class="payment-box"><h3>Record payment</h3><div class="form-row"><div class="form-field"><label for="paymentAmount">Amount (₹)</label><input id="paymentAmount" type="number" min="1" step="1" value="400"></div><div class="form-field"><label for="paymentMethod">Method</label><select id="paymentMethod"><option value="cash">Cash</option><option value="upi">UPI / QR</option></select></div></div><div class="qr-wrap" id="qrArea" hidden><img src="/Images/clinic-upi-qr.png" alt="Clinic UPI QR code"><p class="payment-meta" id="upiIdText">Loading UPI ID...</p><p class="payment-meta">Ask the patient to scan the clinic QR code.</p></div><button class="button action-primary" data-action="save-payment" type="button" style="margin-top:14px">Confirm payment received</button></div>`;
		$('#paymentMethod').addEventListener('change', async event => {
			$('#qrArea').hidden = event.target.value !== 'upi';
			if (event.target.value === 'upi') await loadPaymentInfo();
		});
		await loadPaymentInfo();
	}

	async function loadPaymentInfo() {
		try {
			const data = await request('/api/admin/payment-info');
			const upiId = data.upiId || 'UPI ID not configured';
			if ($('#upiIdText')) $('#upiIdText').textContent = `UPI ID: ${upiId}`;
		} catch (error) {
			if ($('#upiIdText')) $('#upiIdText').textContent = 'UPI ID unavailable';
		}
	}
	function closeModal() { $('#modalBackdrop').hidden = true; state.selected = null; }
	function showToast(message, error = false) { const toast = $('#toast'); toast.textContent = message; toast.className = `toast show${error ? ' error' : ''}`; setTimeout(() => { toast.className = 'toast'; }, 3500); }
	function showLogin(message = '') { $('#loginScreen').hidden = false; $('#loginError').textContent = message; $('#adminKeyInput').focus(); }
	function hideLogin() { $('#loginScreen').hidden = true; $('#loginError').textContent = ''; }

	async function updateStatus(status) { const appointment = state.selected; try { const data = await request(`/api/admin/appointments/${appointment.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); state.appointments = state.appointments.map(item => item.id === appointment.id ? data.appointment : item); renderMetrics(); renderTable(); openModal(data.appointment); showToast(status === 'accepted' ? 'Appointment accepted and patient number assigned.' : `Appointment marked ${status}.`); } catch (error) { showToast(error.message, true); } }
	async function savePayment() { const appointment = state.selected; const amount = Number($('#paymentAmount').value); const method = $('#paymentMethod').value; try { const data = await request(`/api/admin/appointments/${appointment.id}/payment`, { method: 'PATCH', body: JSON.stringify({ amount, method }) }); state.appointments = state.appointments.map(item => item.id === appointment.id ? data.appointment : item); renderMetrics(); renderTable(); openModal(data.appointment); showToast('Payment marked as paid.'); } catch (error) { showToast(error.message, true); } }

	$('#appointmentsBody').addEventListener('click', event => { const button = event.target.closest('[data-id]'); if (button) openModal(state.appointments.find(item => item.id === button.dataset.id)); });
	$('#modalContent').addEventListener('click', event => { const action = event.target.closest('[data-action]')?.dataset.action; if (action === 'accept') updateStatus('accepted'); if (action === 'cancel') updateStatus('cancelled'); if (action === 'complete') updateStatus('completed'); if (action === 'payment') showPaymentForm(); if (action === 'save-payment') savePayment(); });
	$('#searchInput').addEventListener('input', renderTable); $('#refreshButton').addEventListener('click', () => loadAppointments(true)); $('#closeModal').addEventListener('click', closeModal); $('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); }); $('#logoutButton').addEventListener('click', () => { sessionStorage.removeItem('clinicAdminKey'); showLogin(); }); document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); if (event.key === '/' && document.activeElement !== $('#searchInput')) { event.preventDefault(); $('#searchInput').focus(); } });

	$('#loginForm').addEventListener('submit', event => { event.preventDefault(); sessionStorage.setItem('clinicAdminKey', $('#adminKeyInput').value.trim()); hideLogin(); loadAppointments(true); });
	if (adminKey()) { hideLogin(); loadAppointments(true); } else { showLogin(); }
	setInterval(() => { if (adminKey()) loadAppointments(); }, 5000);
})();
