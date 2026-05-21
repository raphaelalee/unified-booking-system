(function () {
    const DATE_CARD_COUNT = 10;

    function parseLocalDate(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);

        if (!match) {
            return null;
        }

        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    function formatDateKey(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    }

    function formatDisplayDate(value) {
        const date = parseLocalDate(value);

        if (!date) {
            return 'Choose a date';
        }

        return date.toLocaleDateString('en-SG', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    }

    function formatDisplayTime(value) {
        const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);

        if (!match) {
            return value || 'Choose a time';
        }

        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const suffix = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;

        return `${displayHours}:${String(minutes).padStart(2, '0')} ${suffix}`;
    }

    function getConfirmButton(form) {
        return form.querySelector('.js-confirm-booking') || form.querySelector('button[type="submit"]');
    }

    function getSelectedOption(serviceSelect) {
        return serviceSelect?.selectedOptions?.[0] || null;
    }

    function getSelectedPurchaseType(serviceSelect) {
        return getSelectedOption(serviceSelect)?.dataset.purchaseType || 'single';
    }

    function getSelectedServiceData(form) {
        const serviceSelect = form.querySelector('.js-service-select');
        const selectedOption = getSelectedOption(serviceSelect);
        const selectedCard = form.querySelector('[data-service-card].is-selected');

        return {
            id: serviceSelect?.value || '',
            purchaseType: getSelectedPurchaseType(serviceSelect),
            name: selectedCard?.dataset.serviceName || selectedOption?.dataset.serviceName || selectedOption?.textContent.trim() || '',
            duration: selectedCard?.dataset.serviceDuration || selectedOption?.dataset.serviceDuration || '',
            price: selectedCard?.dataset.servicePrice || selectedOption?.dataset.servicePrice || ''
        };
    }

    function setServiceSelection(form, serviceId, purchaseType = 'single') {
        const serviceSelect = form.querySelector('.js-service-select');

        if (!serviceSelect) {
            return;
        }

        const option = Array.from(serviceSelect.options).find((candidate) => {
            return candidate.value === String(serviceId)
                && (candidate.dataset.purchaseType || 'single') === purchaseType;
        }) || Array.from(serviceSelect.options).find((candidate) => candidate.value === String(serviceId));

        if (!option) {
            serviceSelect.value = '';
            return;
        }

        serviceSelect.selectedIndex = option.index;
        serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function syncServiceCards(form) {
        const serviceSelect = form.querySelector('.js-service-select');
        const serviceId = serviceSelect?.value || '';
        const purchaseType = getSelectedPurchaseType(serviceSelect);

        form.querySelectorAll('[data-service-card]').forEach((card) => {
            const selected = card.dataset.serviceId === serviceId
                && (card.dataset.purchaseType || 'single') === purchaseType;

            card.classList.toggle('is-selected', selected);
            card.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    function syncPurchaseType(form) {
        const serviceSelect = form.querySelector('.js-service-select');
        const purchaseTypeField = form.querySelector('[data-purchase-type-field]');

        if (purchaseTypeField) {
            purchaseTypeField.value = getSelectedPurchaseType(serviceSelect);
        }
    }

    function setTimeSelectState(form, message, disabled = true) {
        const timeSelect = form.querySelector('.js-time-select');
        const timeList = form.querySelector('.js-time-slot-list');

        if (!timeSelect) {
            return;
        }

        timeSelect.innerHTML = '';
        const option = document.createElement('option');
        option.value = '';
        option.textContent = message;
        timeSelect.appendChild(option);
        timeSelect.value = '';
        timeSelect.disabled = disabled;

        if (timeList) {
            timeList.innerHTML = '';
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'time-slot-pill is-disabled';
            pill.disabled = true;
            pill.textContent = message;
            timeList.appendChild(pill);
        }

        updateSummary(form);
    }

    function syncTimePills(form) {
        const timeSelect = form.querySelector('.js-time-select');
        const selectedTime = timeSelect?.value || '';

        form.querySelectorAll('[data-time-slot]').forEach((button) => {
            const selected = button.dataset.timeSlot === selectedTime;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });

        updateSummary(form);
    }

    function renderAvailableSlots(form, slots, previousValue) {
        const timeSelect = form.querySelector('.js-time-select');
        const timeList = form.querySelector('.js-time-slot-list');

        if (!timeSelect) {
            return;
        }

        const availableSlots = Array.isArray(slots) ? slots : [];
        timeSelect.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = availableSlots.length ? 'Select a time' : 'No available slots';
        timeSelect.appendChild(placeholder);

        availableSlots.forEach((slot) => {
            const option = document.createElement('option');
            option.value = slot;
            option.textContent = formatDisplayTime(slot);
            timeSelect.appendChild(option);
        });

        timeSelect.disabled = availableSlots.length === 0;
        timeSelect.value = availableSlots.includes(previousValue) ? previousValue : '';

        if (timeList) {
            timeList.innerHTML = '';

            if (!availableSlots.length) {
                const empty = document.createElement('button');
                empty.type = 'button';
                empty.className = 'time-slot-pill is-disabled';
                empty.disabled = true;
                empty.textContent = 'No times available';
                timeList.appendChild(empty);
            }

            availableSlots.forEach((slot) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'time-slot-pill';
                button.dataset.timeSlot = slot;
                button.setAttribute('aria-pressed', slot === timeSelect.value ? 'true' : 'false');
                button.textContent = formatDisplayTime(slot);
                button.addEventListener('click', () => {
                    timeSelect.value = slot;
                    timeSelect.dataset.selectedTime = slot;
                    timeSelect.dispatchEvent(new Event('change', { bubbles: true }));
                });
                timeList.appendChild(button);
            });
        }

        syncTimePills(form);
    }

    function loadAvailableSlots(form) {
        const serviceSelect = form.querySelector('.js-service-select');
        const dateInput = form.querySelector('input[name="bookingDate"]');
        const timeSelect = form.querySelector('.js-time-select');
        const availabilityUrl = form.dataset.availabilityUrl;

        if (!serviceSelect || !dateInput || !timeSelect || !availabilityUrl) {
            return;
        }

        if (!dateInput.value && dateInput.min) {
            dateInput.value = dateInput.min;
        }

        const serviceId = serviceSelect.value;
        const bookingDate = dateInput.value;

        if (!serviceId) {
            setTimeSelectState(form, 'Select a service first');
            return;
        }

        if (!bookingDate) {
            setTimeSelectState(form, 'Select a date first');
            return;
        }

        const previousValue = timeSelect.value || timeSelect.dataset.selectedTime || '';
        const params = new URLSearchParams({ serviceId, bookingDate });
        const requestKey = `${serviceId}-${bookingDate}-${Date.now()}`;

        form.dataset.availabilityRequest = requestKey;
        setTimeSelectState(form, 'Checking availability...');

        fetch(`${availabilityUrl}?${params.toString()}`, {
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        })
            .then((response) => response.ok ? response.json() : response.json().then((data) => Promise.reject(data)))
            .then((data) => {
                if (form.dataset.availabilityRequest !== requestKey) {
                    return;
                }

                renderAvailableSlots(form, Array.isArray(data.slots) ? data.slots : [], previousValue);
            })
            .catch((error) => {
                if (form.dataset.availabilityRequest !== requestKey) {
                    return;
                }

                setTimeSelectState(form, error?.message || 'Availability could not be loaded');
            });
    }

    function renderDateCards(form) {
        const dateInput = form.querySelector('input[name="bookingDate"]');
        const dateList = form.querySelector('.js-date-card-list');

        if (!dateInput || !dateList) {
            return;
        }

        const minDate = parseLocalDate(dateInput.min) || new Date();
        const selectedDate = parseLocalDate(dateInput.value) || minDate;

        if (!dateInput.value || selectedDate < minDate) {
            dateInput.value = formatDateKey(minDate);
        }

        dateList.innerHTML = '';

        for (let index = 0; index < DATE_CARD_COUNT; index += 1) {
            const date = new Date(minDate);
            date.setDate(minDate.getDate() + index);

            const dateKey = formatDateKey(date);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'booking-date-card';
            button.dataset.dateValue = dateKey;
            button.setAttribute('aria-pressed', dateInput.value === dateKey ? 'true' : 'false');
            button.innerHTML = `
                <span>${date.toLocaleDateString('en-SG', { weekday: 'short' })}</span>
                <strong>${date.getDate()}</strong>
                <small>${date.toLocaleDateString('en-SG', { month: 'short' })}</small>
            `;

            if (dateInput.value === dateKey) {
                button.classList.add('is-selected');
            }

            button.addEventListener('click', () => {
                dateInput.value = dateKey;
                dateInput.dispatchEvent(new Event('input', { bubbles: true }));
                dateInput.dispatchEvent(new Event('change', { bubbles: true }));
                syncDateCards(form);
            });

            dateList.appendChild(button);
        }

        syncDateCards(form);
    }

    function syncDateCards(form) {
        const dateInput = form.querySelector('input[name="bookingDate"]');
        const selectedDate = dateInput?.value || '';

        form.querySelectorAll('[data-date-value]').forEach((button) => {
            const selected = button.dataset.dateValue === selectedDate;
            button.classList.toggle('is-selected', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });

        updateSummary(form);
    }

    function updateSummary(form) {
        const dateInput = form.querySelector('input[name="bookingDate"]');
        const timeSelect = form.querySelector('.js-time-select');
        const confirmButton = getConfirmButton(form);
        const serviceData = getSelectedServiceData(form);
        const selectedProfessional = form.querySelector('[data-professional-field]')?.value || 'Any Available';
        const hasReadySelection = Boolean(serviceData.id && dateInput?.value && timeSelect?.value);

        const serviceSummary = form.querySelector('.js-summary-service');
        const dateSummary = form.querySelector('.js-summary-date');
        const timeSummary = form.querySelector('.js-summary-time');
        const professionalSummary = form.querySelector('.js-summary-professional');
        const priceSummary = form.querySelector('.js-summary-price');

        if (serviceSummary) {
            serviceSummary.textContent = serviceData.name || 'Select a service';
        }

        if (dateSummary) {
            dateSummary.textContent = formatDisplayDate(dateInput?.value);
        }

        if (timeSummary) {
            timeSummary.textContent = formatDisplayTime(timeSelect?.value);
        }

        if (professionalSummary) {
            professionalSummary.textContent = selectedProfessional;
        }

        if (priceSummary) {
            priceSummary.textContent = serviceData.price ? `$${Number(serviceData.price).toFixed(2)}` : '$0.00';
        }

        if (confirmButton) {
            confirmButton.disabled = !hasReadySelection;
        }
    }

    function initProfessionals(form) {
        const professionalField = form.querySelector('[data-professional-field]');

        form.querySelectorAll('[data-professional]').forEach((button) => {
            button.addEventListener('click', () => {
                const value = button.dataset.professional || 'Any Available';

                if (professionalField) {
                    professionalField.value = value;
                }

                form.querySelectorAll('[data-professional]').forEach((candidate) => {
                    const selected = candidate === button;
                    candidate.classList.toggle('is-selected', selected);
                    candidate.setAttribute('aria-pressed', selected ? 'true' : 'false');
                });

                updateSummary(form);
            });
        });
    }

    document.querySelectorAll('.booking-form').forEach((form) => {
        const serviceSelect = form.querySelector('.js-service-select');
        const dateInput = form.querySelector('input[name="bookingDate"]');
        const timeSelect = form.querySelector('.js-time-select');
        const baseAction = form.dataset.bookingAction || form.action;

        if (!serviceSelect) {
            return;
        }

        form.querySelectorAll('[data-service-card]').forEach((card) => {
            card.addEventListener('click', () => {
                setServiceSelection(form, card.dataset.serviceId, card.dataset.purchaseType || 'single');
            });
        });

        serviceSelect.addEventListener('change', () => {
            form.action = baseAction;
            syncPurchaseType(form);
            syncServiceCards(form);
            loadAvailableSlots(form);
            updateSummary(form);
        });

        dateInput?.addEventListener('change', () => {
            syncDateCards(form);
            loadAvailableSlots(form);
        });

        dateInput?.addEventListener('input', () => {
            syncDateCards(form);
            loadAvailableSlots(form);
        });

        timeSelect?.addEventListener('change', () => syncTimePills(form));

        form.addEventListener('submit', (event) => {
            if (!serviceSelect.value || !dateInput?.value || !timeSelect?.value) {
                event.preventDefault();
                updateSummary(form);
            }
        });

        renderDateCards(form);
        initProfessionals(form);
        syncPurchaseType(form);
        syncServiceCards(form);
        loadAvailableSlots(form);
        updateSummary(form);
    });
}());
