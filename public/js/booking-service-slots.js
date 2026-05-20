(function () {
    function getServiceOptionData(optionSelect) {
        if (optionSelect.dataset.serviceOptionsReady) {
            return JSON.parse(optionSelect.dataset.serviceOptions);
        }

        const options = Array.from(optionSelect.querySelectorAll('option[data-service-id]')).map((option) => ({
            serviceId: option.dataset.serviceId,
            value: option.value,
            label: option.textContent.trim(),
            serviceName: option.closest('optgroup') ? option.closest('optgroup').label : ''
        }));

        optionSelect.dataset.serviceOptionsReady = 'true';
        optionSelect.dataset.serviceOptions = JSON.stringify(options);

        return options;
    }

    function syncServiceOptions(form) {
        const serviceSelect = form.querySelector('.js-service-select');
        const optionSelect = form.querySelector('.js-service-option-select');

        if (!serviceSelect || !optionSelect) {
            return;
        }

        const selectedServiceId = serviceSelect.value;
        const previousValue = optionSelect.value;
        const optionData = getServiceOptionData(optionSelect);
        const visibleOptions = selectedServiceId
            ? optionData.filter((option) => option.serviceId === selectedServiceId)
            : optionData;
        const optionsByService = visibleOptions.reduce((groups, option) => {
            if (!groups[option.serviceId]) {
                groups[option.serviceId] = {
                    serviceName: option.serviceName,
                    options: []
                };
            }

            groups[option.serviceId].options.push(option);
            return groups;
        }, {});

        optionSelect.innerHTML = '<option value="">Select an option</option>';

        Object.keys(optionsByService).forEach((serviceId) => {
            const group = document.createElement('optgroup');
            group.label = optionsByService[serviceId].serviceName;
            group.dataset.serviceId = serviceId;

            optionsByService[serviceId].options.forEach((serviceOption) => {
                const option = document.createElement('option');
                option.value = serviceOption.value;
                option.textContent = serviceOption.label;
                option.dataset.serviceId = serviceOption.serviceId;
                group.appendChild(option);
            });

            optionSelect.appendChild(group);
        });

        optionSelect.value = visibleOptions.some((option) => option.value === previousValue) ? previousValue : '';
    }

    function getConfirmButton(form) {
        return form.querySelector('.js-confirm-booking') || form.querySelector('button[type="submit"]');
    }

    function setTimeSelectState(form, message, disabled = true) {
        const timeSelect = form.querySelector('.js-time-select');
        const confirmButton = getConfirmButton(form);

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

        if (confirmButton) {
            confirmButton.disabled = true;
        }
    }

    function renderAvailableSlots(form, slots, previousValue) {
        const timeSelect = form.querySelector('.js-time-select');
        const confirmButton = getConfirmButton(form);

        if (!timeSelect) {
            return;
        }

        timeSelect.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = slots.length ? 'Select a time' : 'No available slots';
        timeSelect.appendChild(placeholder);

        slots.forEach((slot) => {
            const option = document.createElement('option');
            option.value = slot;
            option.textContent = slot;
            timeSelect.appendChild(option);
        });

        if (slots.includes(previousValue)) {
            timeSelect.value = previousValue;
        } else {
            timeSelect.value = '';
        }

        timeSelect.disabled = slots.length === 0;

        if (confirmButton) {
            confirmButton.disabled = slots.length === 0;
        }
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

        setTimeSelectState(form, 'Checking availability...');

        fetch(`${availabilityUrl}?${params.toString()}`, {
            headers: {
                Accept: 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        })
            .then((response) => response.ok ? response.json() : response.json().then((data) => Promise.reject(data)))
            .then((data) => {
                renderAvailableSlots(form, Array.isArray(data.slots) ? data.slots : [], previousValue);
            })
            .catch((error) => {
                setTimeSelectState(form, error?.message || 'Availability could not be loaded');
            });
    }

    document.querySelectorAll('.booking-form').forEach((form) => {
        const serviceSelect = form.querySelector('.js-service-select');
        const optionSelect = form.querySelector('.js-service-option-select');
        const dateInput = form.querySelector('input[name="bookingDate"]');

        if (!serviceSelect) {
            return;
        }

        syncServiceOptions(form);

        serviceSelect.addEventListener('change', () => {
            syncServiceOptions(form);
            loadAvailableSlots(form);
        });

        if (optionSelect) {
            optionSelect.addEventListener('change', () => loadAvailableSlots(form));
        }

        dateInput?.addEventListener('change', () => loadAvailableSlots(form));
        dateInput?.addEventListener('input', () => loadAvailableSlots(form));
        loadAvailableSlots(form);
    });
}());
