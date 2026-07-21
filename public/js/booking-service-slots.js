(function () {
    const DATE_CARD_COUNT = 14;
    const DATE_NAV_STEP_DAYS = 7;

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

    function addDays(date, days) {
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + days);
        return nextDate;
    }

    function addMonths(date, months) {
        const nextDate = new Date(date);
        const originalDay = nextDate.getDate();

        nextDate.setDate(1);
        nextDate.setMonth(nextDate.getMonth() + months);
        nextDate.setDate(Math.min(originalDay, new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate()));

        return nextDate;
    }

    function clampDate(date, minDate, maxDate) {
        if (date < minDate) {
            return new Date(minDate);
        }

        if (date > maxDate) {
            return new Date(maxDate);
        }

        return new Date(date);
    }

    function getDateBounds(dateInput) {
        const minDate = parseLocalDate(dateInput?.min) || new Date();
        const parsedMaxDate = parseLocalDate(dateInput?.max);
        const fallbackMaxDate = addMonths(minDate, 2);
        const maxDate = parsedMaxDate && parsedMaxDate > minDate ? parsedMaxDate : fallbackMaxDate;

        return {
            minDate,
            maxDate
        };
    }

    function getVisibleDates(windowStart, maxDate) {
        const visibleDates = [];

        for (let index = 0; index < DATE_CARD_COUNT; index += 1) {
            const date = addDays(windowStart, index);

            if (date > maxDate) {
                break;
            }

            visibleDates.push(date);
        }

        return visibleDates;
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
        let reward = {};

        try {
            reward = JSON.parse(selectedCard?.dataset.reward || selectedOption?.dataset.reward || '{}');
        } catch (error) {
            reward = {};
        }

        return {
            id: serviceSelect?.value || '',
            purchaseType: getSelectedPurchaseType(serviceSelect),
            name: selectedCard?.dataset.serviceName || selectedOption?.dataset.serviceName || selectedOption?.textContent.trim() || '',
            duration: selectedCard?.dataset.serviceDuration || selectedOption?.dataset.serviceDuration || '',
            price: selectedCard?.dataset.servicePrice || selectedOption?.dataset.servicePrice || '',
            reward
        };
    }

    function formatMoney(value) {
        return `$${Number(value || 0).toFixed(2)}`;
    }

    function formatPoints(value) {
        const points = Math.max(0, Math.floor(Number(value || 0)));
        return `${points} pt${points === 1 ? '' : 's'}`;
    }

    function calculateRewardEstimate(serviceData, requestedPoints) {
        const reward = serviceData.reward || {};
        const price = Number(serviceData.price || 0);
        const walletPoints = Math.max(0, Math.floor(Number(reward.walletPoints || 0)));
        const minPoints = Math.max(0, Math.floor(Number(reward.minPointsToRedeem || 0)));
        const rate = Number(reward.pointsToCashRate || 0);
        const maxPercent = Math.max(0, Number(reward.maxDiscountPercent || 0));
        const maxDiscount = Math.min(price, price * (maxPercent / 100));
        const maxPointsByDiscount = rate > 0 ? Math.floor(maxDiscount / rate) : 0;
        const maxEligiblePoints = Math.max(0, Math.min(walletPoints, maxPointsByDiscount));
        const selectedPoints = Math.max(0, Math.min(Math.floor(Number(requestedPoints || 0)), maxEligiblePoints));
        const validSelectedPoints = selectedPoints >= minPoints ? selectedPoints : 0;
        const discount = Math.min(price, maxDiscount, validSelectedPoints * rate);

        return {
            enabled: Boolean(reward.enabled) && price > 0,
            reason: reward.reason || '',
            price,
            walletPoints,
            minPoints,
            rate,
            maxPercent,
            maxDiscount,
            maxEligiblePoints,
            selectedPoints,
            appliedPoints: validSelectedPoints,
            discount,
            finalAmount: Math.max(0, price - discount)
        };
    }

    function updateRewardSummary(form, serviceData) {
        const rewardPanel = form.querySelector('[data-booking-rewards]');

        if (!rewardPanel) {
            return;
        }

        const toggle = rewardPanel.querySelector('[data-reward-toggle]');
        const pointsInput = rewardPanel.querySelector('[data-reward-points]');
        const maxButton = rewardPanel.querySelector('[data-reward-max]');
        const requestedPoints = toggle?.checked ? pointsInput?.value : 0;
        const estimate = calculateRewardEstimate(serviceData, requestedPoints);
        const setText = (selector, value) => {
            const node = rewardPanel.querySelector(selector);
            if (node) node.textContent = value;
        };

        const canRedeem = estimate.enabled && estimate.maxEligiblePoints >= estimate.minPoints && estimate.minPoints > 0;

        setText('[data-reward-available]', formatPoints(estimate.walletPoints));
        setText('[data-reward-min]', formatPoints(estimate.minPoints));
        setText('[data-reward-rate]', estimate.rate > 0 ? `${Math.round(1 / estimate.rate)} pts = $1.00` : 'Unavailable');
        setText('[data-reward-max-discount]', `${formatMoney(estimate.maxDiscount)} (${estimate.maxPercent}%)`);
        setText('[data-reward-original]', formatMoney(estimate.price));
        setText('[data-reward-selected]', formatPoints(toggle?.checked ? estimate.selectedPoints : 0));
        setText('[data-reward-discount]', formatMoney(toggle?.checked ? estimate.discount : 0));
        setText('[data-reward-final]', formatMoney(toggle?.checked ? estimate.finalAmount : estimate.price));
        setText(
            '[data-reward-status]',
            !serviceData.id
                ? 'Select a service to check reward eligibility.'
                : canRedeem
                    ? `You can redeem up to ${formatPoints(estimate.maxEligiblePoints)}.`
                    : (estimate.reason || 'Not enough eligible points for this booking.')
        );

        if (toggle) {
            toggle.disabled = !canRedeem;
            if (!canRedeem) {
                toggle.checked = false;
            }
        }

        if (pointsInput) {
            pointsInput.disabled = !canRedeem || !toggle?.checked;
            pointsInput.min = canRedeem ? String(estimate.minPoints) : '0';
            pointsInput.max = String(estimate.maxEligiblePoints);
            if (!toggle?.checked) {
                pointsInput.value = '0';
            } else if (Number(pointsInput.value || 0) > estimate.maxEligiblePoints) {
                pointsInput.value = String(estimate.maxEligiblePoints);
            }
        }

        if (maxButton) {
            maxButton.disabled = !canRedeem || !toggle?.checked;
        }
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

    function setBookingDateValue(form, dateKey) {
        const dateInput = form.querySelector('input[name="bookingDate"]');

        if (!dateInput) {
            return;
        }

        dateInput.value = dateKey;
        dateInput.dispatchEvent(new Event('change', { bubbles: true }));
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
        placeholder.textContent = availableSlots.length ? 'Select a time' : 'No available slots for this date. Please choose another date.';
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
                empty.textContent = 'No available slots for this date. Please choose another date.';
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
        const selectedDate = parseLocalDate(bookingDate);
        const { minDate, maxDate } = getDateBounds(dateInput);

        if (!serviceId) {
            setTimeSelectState(form, 'Select a service first');
            return;
        }

        if (!bookingDate) {
            setTimeSelectState(form, 'Select a date first');
            return;
        }

        if (!selectedDate || selectedDate < minDate) {
            setTimeSelectState(form, 'Choose today or a future date');
            updateSummary(form);
            return;
        }

        if (selectedDate > maxDate) {
            setTimeSelectState(form, 'Choose a date within 2 months');
            updateSummary(form);
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

    function getDateControls(form, dateList) {
        const card = dateList.closest('.booking-picker-card') || dateList.parentElement;
        let controls = card.querySelector('.js-date-controls');

        if (!controls) {
            controls = document.createElement('div');
            controls.className = 'booking-date-controls js-date-controls';
            controls.innerHTML = `
                <span class="booking-date-range js-date-range" aria-live="polite"></span>
                <div class="booking-date-nav">
                    <button class="button secondary compact js-date-prev" type="button">Previous Week</button>
                    <button class="button secondary compact js-date-next" type="button">Next Week</button>
                </div>
            `;
            card.insertBefore(controls, dateList);
        }

        if (controls.dataset.ready !== 'true') {
            const shiftWindow = (dayOffset) => {
                const dateInput = form.querySelector('input[name="bookingDate"]');
                const { minDate, maxDate } = getDateBounds(dateInput);
                const latestWindowStart = clampDate(addDays(maxDate, -(DATE_CARD_COUNT - 1)), minDate, maxDate);
                const currentStart = parseLocalDate(form.dataset.dateWindowStart) || parseLocalDate(dateInput.value) || minDate;
                const nextStart = clampDate(addDays(currentStart, dayOffset), minDate, latestWindowStart);

                form.dataset.dateWindowStart = formatDateKey(nextStart);
                setBookingDateValue(form, formatDateKey(nextStart));
            };

            controls.querySelector('.js-date-prev')?.addEventListener('click', () => shiftWindow(-DATE_NAV_STEP_DAYS));
            controls.querySelector('.js-date-next')?.addEventListener('click', () => shiftWindow(DATE_NAV_STEP_DAYS));
            controls.dataset.ready = 'true';
        }

        return controls;
    }

    function renderDateCards(form) {
        const dateInput = form.querySelector('input[name="bookingDate"]');
        const dateList = form.querySelector('.js-date-card-list');

        if (!dateInput || !dateList) {
            return;
        }

        const { minDate, maxDate } = getDateBounds(dateInput);
        const selectedDate = clampDate(parseLocalDate(dateInput.value) || minDate, minDate, maxDate);
        const latestWindowStart = clampDate(addDays(maxDate, -(DATE_CARD_COUNT - 1)), minDate, maxDate);
        let windowStart = parseLocalDate(form.dataset.dateWindowStart) || selectedDate;

        if (!dateInput.value || formatDateKey(selectedDate) !== dateInput.value) {
            dateInput.value = formatDateKey(selectedDate);
        }

        if (selectedDate < windowStart || selectedDate > addDays(windowStart, DATE_CARD_COUNT - 1)) {
            windowStart = selectedDate;
        }

        windowStart = clampDate(windowStart, minDate, latestWindowStart);
        form.dataset.dateWindowStart = formatDateKey(windowStart);
        dateList.innerHTML = '';

        const controls = getDateControls(form, dateList);
        const visibleDates = getVisibleDates(windowStart, maxDate);
        const prevButton = controls.querySelector('.js-date-prev');
        const nextButton = controls.querySelector('.js-date-next');
        const rangeLabel = controls.querySelector('.js-date-range');

        if (prevButton) {
            prevButton.disabled = addDays(windowStart, -DATE_NAV_STEP_DAYS) < minDate;
        }

        if (nextButton) {
            nextButton.disabled = addDays(windowStart, DATE_NAV_STEP_DAYS) > latestWindowStart;
        }

        if (rangeLabel && visibleDates.length) {
            const firstVisibleDate = visibleDates[0];
            const lastVisibleDate = visibleDates[visibleDates.length - 1];
            rangeLabel.textContent = `${firstVisibleDate.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })} - ${lastVisibleDate.toLocaleDateString('en-SG', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        }

        visibleDates.forEach((date) => {
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
                setBookingDateValue(form, dateKey);
            });

            dateList.appendChild(button);
        });

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

        updateRewardSummary(form, serviceData);

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
            const serviceOptionField = form.querySelector('[name="serviceOptionId"]');
            if (serviceOptionField) {
                serviceOptionField.value = '';
            }

            form.action = baseAction;
            syncPurchaseType(form);
            syncServiceCards(form);
            loadAvailableSlots(form);
            updateSummary(form);
        });

        dateInput?.addEventListener('change', () => {
            renderDateCards(form);
            loadAvailableSlots(form);
        });

        timeSelect?.addEventListener('change', () => syncTimePills(form));

        const rewardPanel = form.querySelector('[data-booking-rewards]');
        const rewardToggle = rewardPanel?.querySelector('[data-reward-toggle]');
        const rewardPoints = rewardPanel?.querySelector('[data-reward-points]');
        const rewardMax = rewardPanel?.querySelector('[data-reward-max]');

        rewardToggle?.addEventListener('change', () => updateSummary(form));
        rewardPoints?.addEventListener('input', () => updateSummary(form));
        rewardMax?.addEventListener('click', () => {
            const estimate = calculateRewardEstimate(getSelectedServiceData(form), rewardPoints?.value || 0);
            if (rewardPoints) {
                rewardPoints.value = String(estimate.maxEligiblePoints || 0);
            }
            updateSummary(form);
        });

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
