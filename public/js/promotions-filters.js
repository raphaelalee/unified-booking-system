(() => {
    const list = document.querySelector('[data-promotions-list]');
    const count = document.querySelector('[data-promotions-count]');
    const emptyState = document.querySelector('[data-promotions-empty]');
    const clearButton = document.querySelector('.filter-clear-button');
    const filterInputs = [...document.querySelectorAll('[data-filter-group]')];

    if (!list || !count || filterInputs.length === 0) {
        return;
    }

    const cards = [...list.querySelectorAll('.promotion-offer-card')];

    const getActiveFilters = () => {
        return filterInputs.reduce((groups, input) => {
            if (!input.checked) {
                return groups;
            }

            const group = input.dataset.filterGroup;
            groups[group] = groups[group] || [];
            groups[group].push(input.value);
            return groups;
        }, {});
    };

    const matchesCard = (card, activeFilters) => {
        return Object.entries(activeFilters).every(([group, values]) => {
            const cardValue = card.dataset[group];
            return values.includes(cardValue);
        });
    };

    const applyFilters = () => {
        const activeFilters = getActiveFilters();
        let visibleCount = 0;

        cards.forEach((card) => {
            const isVisible = matchesCard(card, activeFilters);
            card.hidden = !isVisible;

            if (isVisible) {
                visibleCount += 1;
            }
        });

        count.textContent = String(visibleCount);
        emptyState.classList.toggle('is-hidden', visibleCount > 0);
    };

    filterInputs.forEach((input) => {
        input.addEventListener('change', applyFilters);
    });

    clearButton?.addEventListener('click', () => {
        filterInputs.forEach((input) => {
            input.checked = false;
        });
        applyFilters();
    });

    applyFilters();
})();
