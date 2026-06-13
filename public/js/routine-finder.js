(function () {
    const form = document.querySelector('[data-routine-form]');
    if (!form) return;

    const steps = Array.from(form.querySelectorAll('[data-routine-step]'));
    const prevButton = form.querySelector('[data-routine-prev]');
    const nextButton = form.querySelector('[data-routine-next]');
    const submitButton = form.querySelector('[data-routine-submit]');
    const label = form.querySelector('[data-routine-step-label]');
    const progress = form.querySelector('[data-routine-progress]');
    const summary = form.querySelector('[data-routine-summary]');
    const loading = form.querySelector('[data-routine-loading]');
    let currentStep = 0;

    function selectedLabels(selector) {
        return Array.from(form.querySelectorAll(selector))
            .filter((input) => input.checked || (input.tagName === 'SELECT' && input.value) || (input.type === 'search' && input.value.trim()))
            .map((input) => {
                if (input.tagName === 'SELECT') {
                    return input.options[input.selectedIndex]?.text || '';
                }

                if (input.type === 'search') {
                    return input.value.trim();
                }

                return input.closest('label')?.innerText.trim() || input.value;
            })
            .filter(Boolean);
    }

    function updateSummary() {
        if (!summary) return;

        const goals = selectedLabels('input[name="goals"]');
        const concerns = selectedLabels('input[name="concerns"]');
        const category = selectedLabels('select[name="category"]')[0];
        const productNeed = selectedLabels('select[name="productNeed"]')[0];
        const budget = selectedLabels('select[name="budget"]')[0];
        const location = selectedLabels('input[name="locationPreference"]')[0];
        const parts = [
            goals.length ? `Goals: ${goals.join(', ')}` : '',
            concerns.length ? `Concerns: ${concerns.join(', ')}` : '',
            category && category !== 'Any service type' ? `Service: ${category}` : '',
            productNeed && productNeed !== 'No product preference' ? `Product: ${productNeed}` : '',
            budget && budget !== 'Any budget' ? `Budget: ${budget}` : '',
            location ? `Area: ${location}` : ''
        ].filter(Boolean);

        summary.innerHTML = `
            <p class="eyebrow">Consultation summary</p>
            <strong>${parts.length ? 'Ready to score your routine' : 'Your selected preferences will appear here.'}</strong>
            <span>${parts.length ? parts.join(' | ') : 'We will use them to score live merchants, services, and products.'}</span>
        `;
    }

    function showStep(index) {
        currentStep = Math.max(0, Math.min(index, steps.length - 1));
        steps.forEach((step, stepIndex) => {
            step.classList.toggle('is-active', stepIndex === currentStep);
        });

        if (label) label.textContent = `Step ${currentStep + 1} of ${steps.length}`;
        if (progress) progress.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
        if (prevButton) prevButton.disabled = currentStep === 0;
        if (nextButton) nextButton.hidden = currentStep === steps.length - 1;
        if (submitButton) submitButton.hidden = currentStep !== steps.length - 1;
        updateSummary();
    }

    prevButton?.addEventListener('click', () => showStep(currentStep - 1));
    nextButton?.addEventListener('click', () => showStep(currentStep + 1));
    form.addEventListener('change', updateSummary);
    form.addEventListener('input', updateSummary);
    form.addEventListener('submit', () => {
        if (loading) loading.hidden = false;
        if (submitButton) submitButton.disabled = true;
    });

    document.querySelectorAll('[data-routine-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            const filter = button.dataset.routineFilter || 'all';
            document.querySelectorAll('[data-routine-filter]').forEach((item) => {
                item.classList.toggle('is-active', item === button);
            });
            document.querySelectorAll('[data-routine-result-group]').forEach((group) => {
                group.hidden = filter !== 'all' && group.dataset.routineResultGroup !== filter;
            });
        });
    });

    showStep(0);
})();
