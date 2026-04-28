(function () {
    function getOptionData(timeSelect) {
        if (timeSelect.dataset.slotOptionsReady) {
            return JSON.parse(timeSelect.dataset.slotOptions);
        }

        const options = Array.from(timeSelect.querySelectorAll('option[data-service-id]')).map((option) => ({
            serviceId: option.dataset.serviceId,
            value: option.value,
            label: option.textContent.trim(),
            serviceName: option.closest('optgroup') ? option.closest('optgroup').label : ''
        }));

        timeSelect.dataset.slotOptionsReady = 'true';
        timeSelect.dataset.slotOptions = JSON.stringify(options);

        return options;
    }

    function syncTimeSlots(form) {
        const serviceSelect = form.querySelector('.js-service-select');
        const timeSelect = form.querySelector('.js-time-select');

        if (!serviceSelect || !timeSelect) {
            return;
        }

        const selectedServiceId = serviceSelect.value;
        const previousValue = timeSelect.value;
        const slotOptions = getOptionData(timeSelect);
        const visibleSlots = selectedServiceId
            ? slotOptions.filter((option) => option.serviceId === selectedServiceId)
            : slotOptions;
        const slotsByService = visibleSlots.reduce((groups, option) => {
            if (!groups[option.serviceId]) {
                groups[option.serviceId] = {
                    serviceName: option.serviceName,
                    options: []
                };
            }

            groups[option.serviceId].options.push(option);
            return groups;
        }, {});

        timeSelect.innerHTML = '<option value="">Select a time</option>';

        Object.keys(slotsByService).forEach((serviceId) => {
            const group = document.createElement('optgroup');
            group.label = slotsByService[serviceId].serviceName;
            group.dataset.serviceId = serviceId;

            slotsByService[serviceId].options.forEach((slot) => {
                const option = document.createElement('option');
                option.value = slot.value;
                option.textContent = slot.label;
                option.dataset.serviceId = slot.serviceId;
                group.appendChild(option);
            });

            timeSelect.appendChild(group);
        });

        if (visibleSlots.some((option) => option.value === previousValue)) {
            timeSelect.value = previousValue;
        } else {
            timeSelect.value = '';
        }
    }

    document.querySelectorAll('.booking-form').forEach((form) => {
        const serviceSelect = form.querySelector('.js-service-select');

        if (!serviceSelect) {
            return;
        }

        syncTimeSlots(form);
        serviceSelect.addEventListener('change', () => syncTimeSlots(form));
    });
}());
