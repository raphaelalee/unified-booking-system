(function () {
    function getOptionData(timeSelect) {
        if (timeSelect.dataset.slotOptionsReady) {
            return JSON.parse(timeSelect.dataset.slotOptions);
        }

        const options = Array.from(timeSelect.querySelectorAll('option[data-service-id]')).map((option) => ({
            serviceId: option.dataset.serviceId,
            serviceOptionId: option.dataset.serviceOptionId || '',
            value: option.value,
            label: option.textContent.trim(),
            serviceName: option.closest('optgroup') ? option.closest('optgroup').label : ''
        }));

        timeSelect.dataset.slotOptionsReady = 'true';
        timeSelect.dataset.slotOptions = JSON.stringify(options);

        return options;
    }

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

        if (visibleOptions.some((option) => option.value === previousValue)) {
            optionSelect.value = previousValue;
        } else {
            optionSelect.value = '';
        }
    }

    function syncTimeSlots(form) {
        const serviceSelect = form.querySelector('.js-service-select');
        const optionSelect = form.querySelector('.js-service-option-select');
        const timeSelect = form.querySelector('.js-time-select');

        if (!serviceSelect || !timeSelect) {
            return;
        }

        const selectedServiceId = serviceSelect.value;
        const selectedOptionId = optionSelect ? optionSelect.value : '';
        const previousValue = timeSelect.value;
        const slotOptions = getOptionData(timeSelect);
        const visibleSlots = slotOptions.filter((option) => {
            if (selectedOptionId) {
                return option.serviceOptionId === selectedOptionId;
            }

            return selectedServiceId ? option.serviceId === selectedServiceId : true;
        });
        const slotsByService = visibleSlots.reduce((groups, option) => {
            const groupKey = `${option.serviceId}:${option.serviceOptionId}`;

            if (!groups[groupKey]) {
                groups[groupKey] = {
                    serviceId: option.serviceId,
                    serviceOptionId: option.serviceOptionId,
                    serviceName: option.serviceName,
                    options: []
                };
            }

            groups[groupKey].options.push(option);
            return groups;
        }, {});

        timeSelect.innerHTML = '<option value="">Select a time</option>';

        Object.keys(slotsByService).forEach((groupKey) => {
            const group = document.createElement('optgroup');
            group.label = slotsByService[groupKey].serviceName;
            group.dataset.serviceId = slotsByService[groupKey].serviceId;
            group.dataset.serviceOptionId = slotsByService[groupKey].serviceOptionId;

            slotsByService[groupKey].options.forEach((slot) => {
                const option = document.createElement('option');
                option.value = slot.value;
                option.textContent = slot.label;
                option.dataset.serviceId = slot.serviceId;
                option.dataset.serviceOptionId = slot.serviceOptionId;
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
        const optionSelect = form.querySelector('.js-service-option-select');

        if (!serviceSelect) {
            return;
        }

        syncServiceOptions(form);
        syncTimeSlots(form);
        serviceSelect.addEventListener('change', () => {
            syncServiceOptions(form);
            syncTimeSlots(form);
        });

        if (optionSelect) {
            optionSelect.addEventListener('change', () => syncTimeSlots(form));
        }
    });
}());
