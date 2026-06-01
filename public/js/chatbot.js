(() => {
    const widget = document.querySelector('.ai-chatbot');

    if (!widget) {
        return;
    }

    const toggle = widget.querySelector('.ai-chatbot-toggle');
    const panel = widget.querySelector('.ai-chatbot-panel');
    const closeButton = widget.querySelector('.ai-chatbot-close');
    const form = widget.querySelector('.ai-chatbot-form');
    const input = widget.querySelector('#ai-chatbot-input');
    const messages = widget.querySelector('.ai-chatbot-messages');
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    const state = {
        options: null,
        merchant: null,
        service: null,
        date: null,
        booking: null
    };

    const scrollMessages = () => {
        messages.scrollTop = messages.scrollHeight;
    };

    const setOpen = (isOpen) => {
        panel.hidden = !isOpen;
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

        if (isOpen) {
            window.setTimeout(() => input.focus(), 0);
        }
    };

    const addMessage = (text, type) => {
        const message = document.createElement('div');
        message.className = `ai-chatbot-message ${type}`;
        message.textContent = text;
        messages.appendChild(message);
        scrollMessages();
        return message;
    };

    const addButtonGroup = (buttons) => {
        const group = document.createElement('div');
        group.className = 'ai-chatbot-actions';

        buttons.forEach((buttonConfig) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'ai-chatbot-choice';
            button.textContent = buttonConfig.label;
            button.disabled = Boolean(buttonConfig.disabled);
            button.addEventListener('click', buttonConfig.onClick);
            group.appendChild(button);
        });

        messages.appendChild(group);
        scrollMessages();
        return group;
    };

    const renderList = (items, formatter) => {
        if (!Array.isArray(items) || !items.length) {
            return '';
        }

        return `\n\n${items.map(formatter).join('\n')}`;
    };

    const formatResult = (result) => {
        let text = result.answer || result.message || 'Done.';

        text += renderList(result.suggestions, (item) => {
            const price = Number.isFinite(Number(item.price)) ? ` - $${Number(item.price).toFixed(2)}` : '';
            return `Service ${item.id}: ${item.name} at ${item.merchantName}${price}`;
        });

        text += renderList(result.bookings, (item) => {
            return `Booking ${item.id}: ${item.serviceName} at ${item.merchantName} on ${item.bookingDate} ${item.bookingTime || ''}`.trim();
        });

        if (result.booking?.receiptPath) {
            text += `\n\nReceipt: ${result.booking.receiptPath}`;
        }

        return text;
    };

    const fetchJson = async (url, options = {}) => {
        const response = await fetch(url, {
            ...options,
            headers: {
                Accept: 'application/json',
                ...(options.headers || {})
            }
        });
        const result = await response.json();

        if (!response.ok || result.success === false) {
            throw new Error(result.message || 'This option could not be loaded.');
        }

        return result;
    };

    const submitChatMessage = async (message, displayText = message) => {
        addMessage(displayText, 'user');
        input.disabled = true;
        const loadingMessage = addMessage('Working on it...', 'bot');

        try {
            const result = await fetchJson('/api/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({ userQuery: message })
            });

            loadingMessage.textContent = formatResult(result);
            showStartActions();
        } catch (error) {
            loadingMessage.textContent = error.message || 'Sorry, I could not complete that just now.';
        } finally {
            input.disabled = false;
            input.focus();
            scrollMessages();
        }
    };

    const loadBookingOptions = async () => {
        if (state.options) {
            return state.options;
        }

        state.options = await fetchJson('/api/ai/booking-options');
        return state.options;
    };

    const showStartActions = () => {
        addButtonGroup([
            { label: 'Bookings', onClick: startBookingFlow },
            { label: 'Reschedule', onClick: startRescheduleFlow },
            { label: 'Booking cancellation', onClick: startCancelFlow }
        ]);
    };

    const startBookingFlow = async () => {
        addMessage('Bookings', 'user');
        const loadingMessage = addMessage('Loading merchants...', 'bot');

        try {
            const options = await loadBookingOptions();
            loadingMessage.textContent = 'Choose a merchant.';
            addButtonGroup(options.merchants.slice(0, 12).map((merchant) => ({
                label: merchant.name,
                onClick: () => showServicesForMerchant(merchant)
            })));
        } catch (error) {
            loadingMessage.textContent = error.message || 'Merchants could not be loaded.';
        }
    };

    const showServicesForMerchant = (merchant) => {
        state.merchant = merchant;
        state.service = null;
        state.date = null;
        addMessage(merchant.name, 'user');
        addMessage('Choose a service.', 'bot');
        addButtonGroup((merchant.services || []).slice(0, 12).map((service) => {
            const price = Number.isFinite(Number(service.price)) ? ` $${Number(service.price).toFixed(2)}` : '';
            return {
                label: `${service.name}${price}`,
                onClick: () => showBookingDates(service)
            };
        }));
    };

    const showBookingDates = async (service) => {
        const options = await loadBookingOptions();

        state.service = service;
        state.date = null;
        addMessage(service.name, 'user');
        addMessage('Choose a date.', 'bot');
        addButtonGroup(options.dates.map((date) => ({
            label: date.label,
            onClick: () => showBookingTimes(date)
        })));
    };

    const showBookingTimes = async (date) => {
        state.date = date;
        addMessage(date.label, 'user');
        const loadingMessage = addMessage('Checking available times...', 'bot');

        try {
            const params = new URLSearchParams({
                merchantId: state.merchant.id,
                serviceId: state.service.id,
                bookingDate: date.dateKey
            });
            const result = await fetchJson(`/api/ai/booking-slots?${params.toString()}`);
            loadingMessage.textContent = result.slots.length ? 'Choose a time.' : (result.message || 'No available times for this date.');

            if (result.slots.length) {
                addButtonGroup(result.slots.map((slot) => ({
                    label: slot,
                    onClick: () => submitChatMessage(
                        `book service ${state.service.id} on ${state.date.dateKey} at ${slot}`,
                        `${state.service.name} on ${state.date.dateKey} at ${slot}`
                    )
                })));
            }
        } catch (error) {
            loadingMessage.textContent = error.message || 'Available times could not be loaded.';
        }
    };

    const loadCustomerBookings = async () => {
        return fetchJson('/api/ai/customer-bookings');
    };

    const startRescheduleFlow = async () => {
        addMessage('Reschedule', 'user');
        const loadingMessage = addMessage('Loading your bookings...', 'bot');

        try {
            const result = await loadCustomerBookings();
            loadingMessage.textContent = result.bookings.length ? 'Choose a booking to reschedule.' : 'You do not have upcoming bookings to reschedule.';

            if (result.bookings.length) {
                addButtonGroup(result.bookings.map((booking) => ({
                    label: `${booking.serviceName} #${booking.id}`,
                    onClick: () => showRescheduleDates(booking, result.dates)
                })));
            }
        } catch (error) {
            loadingMessage.textContent = error.message || 'Your bookings could not be loaded.';
        }
    };

    const showRescheduleDates = (booking, dates) => {
        state.booking = booking;
        state.date = null;
        addMessage(`Booking ${booking.id}`, 'user');
        addMessage('Choose the new date.', 'bot');
        addButtonGroup(dates.map((date) => ({
            label: date.label,
            onClick: () => showRescheduleTimes(date)
        })));
    };

    const showRescheduleTimes = async (date) => {
        state.date = date;
        addMessage(date.label, 'user');
        const loadingMessage = addMessage('Checking reschedule times...', 'bot');

        try {
            const params = new URLSearchParams({ bookingDate: date.dateKey });
            const result = await fetchJson(`/profile/bookings/${state.booking.id}/reschedule-suggestions?${params.toString()}`);
            loadingMessage.textContent = result.slots.length ? 'Choose the new time.' : (result.message || 'No available times for this date.');

            if (result.slots.length) {
                addButtonGroup(result.slots.map((slot) => ({
                    label: slot,
                    onClick: () => submitChatMessage(
                        `reschedule booking ${state.booking.id} to ${state.date.dateKey} at ${slot}`,
                        `Move booking ${state.booking.id} to ${state.date.dateKey} at ${slot}`
                    )
                })));
            }
        } catch (error) {
            loadingMessage.textContent = error.message || 'Reschedule times could not be loaded.';
        }
    };

    const startCancelFlow = async () => {
        addMessage('Booking cancellation', 'user');
        const loadingMessage = addMessage('Loading your bookings...', 'bot');

        try {
            const result = await loadCustomerBookings();
            loadingMessage.textContent = result.bookings.length ? 'Choose a booking to cancel.' : 'You do not have upcoming bookings to cancel.';

            if (result.bookings.length) {
                addButtonGroup(result.bookings.map((booking) => ({
                    label: `${booking.serviceName} #${booking.id}`,
                    onClick: () => showCancelReasons(booking)
                })));
            }
        } catch (error) {
            loadingMessage.textContent = error.message || 'Your bookings could not be loaded.';
        }
    };

    const showCancelReasons = (booking) => {
        state.booking = booking;
        addMessage(`Booking ${booking.id}`, 'user');
        addMessage('Choose a cancellation reason.', 'bot');
        addButtonGroup([
            'Schedule conflict',
            'No longer needed',
            'Booked by mistake',
            'Other reason'
        ].map((reason) => ({
            label: reason,
            onClick: () => submitChatMessage(
                `cancel booking ${booking.id} because ${reason}`,
                `Cancel booking ${booking.id}: ${reason}`
            )
        })));
    };

    toggle.addEventListener('click', () => {
        setOpen(panel.hidden);
    });

    closeButton.addEventListener('click', () => {
        setOpen(false);
        toggle.focus();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const userMessage = input.value.trim();

        if (!userMessage) {
            return;
        }

        input.value = '';
        submitChatMessage(userMessage);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !panel.hidden) {
            setOpen(false);
            toggle.focus();
        }
    });

    showStartActions();
})();
