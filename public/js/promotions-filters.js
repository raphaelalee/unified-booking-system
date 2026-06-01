(() => {
    const normalize = (value) => String(value || '').trim().toLowerCase();

    const initPromotionFilters = () => {
        const list = document.querySelector('[data-promotions-list]');
        const count = document.querySelector('[data-promotions-count]');
        const emptyState = document.querySelector('[data-promotions-empty]');
        const clearButton = document.querySelector('.filter-clear-button');
        const filterInputs = [...document.querySelectorAll('[data-filter-group]')];
        const priceInput = document.querySelector('[data-promotion-price]');
        const priceOutput = document.querySelector('[data-promotion-price-output]');

        if (!list || !count) {
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
                groups[group].push(normalize(input.value));
                return groups;
            }, {});
        };

        const matchesCard = (card, activeFilters) => {
            return Object.entries(activeFilters).every(([group, values]) => {
                const cardValue = normalize(card.dataset[group]);
                return values.includes(cardValue);
            });
        };

        const applyFilters = () => {
            const activeFilters = getActiveFilters();
            const maxPrice = priceInput ? Number(priceInput.value || priceInput.max || 0) : Number.POSITIVE_INFINITY;
            let visibleCount = 0;

            cards.forEach((card) => {
                const cardAmount = Number(card.dataset.amount || 0);
                const isVisible = matchesCard(card, activeFilters) && cardAmount <= maxPrice;
                card.hidden = !isVisible;
                card.style.display = isVisible ? '' : 'none';

                if (isVisible) {
                    visibleCount += 1;
                }
            });

            count.textContent = String(visibleCount);

            if (emptyState) {
                emptyState.classList.toggle('is-hidden', visibleCount > 0);
                emptyState.hidden = visibleCount > 0;
            }
        };

        const syncPriceLabel = () => {
            if (!priceInput || !priceOutput) {
                return;
            }

            priceOutput.textContent = `$${Number(priceInput.value || 0).toFixed(0)}`;
        };

        document.addEventListener('change', (event) => {
            if (event.target && event.target.matches('[data-filter-group]')) {
                applyFilters();
            }
        });

        priceInput?.addEventListener('input', () => {
            syncPriceLabel();
            applyFilters();
        });

        clearButton?.addEventListener('click', () => {
            filterInputs.forEach((input) => {
                input.checked = false;
            });

            if (priceInput) {
                priceInput.value = priceInput.max;
            }

            syncPriceLabel();
            applyFilters();
        });

        syncPriceLabel();
        applyFilters();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPromotionFilters, { once: true });
    } else {
        initPromotionFilters();
    }
})();
