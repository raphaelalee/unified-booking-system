(() => {
    const SEARCHABLE_ITEM_SELECTOR = [
        '[data-live-search-item]',
        '[data-service-card]',
        '[data-product-card]',
        '[data-promotion-card]',
        '.promotion-offer-card',
        '.merchant-row',
        '.merchant-card',
        '.service-catalog-card',
        '.marketplace-product-card',
        '.profile-booking-card',
        '.profile-review-queue-card',
        '.notification-card',
        '.admin-merchant-card',
        '.admin-table tbody tr',
        '.merchant-table tbody tr',
        '.table-card tbody tr',
        'table tbody tr'
    ].join(',');

    const normalize = (value) => String(value || '').trim().toLowerCase();

    const debounce = (callback, delay = 240) => {
        let timer = null;

        return (...args) => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => callback(...args), delay);
        };
    };

    const getSearchText = (item) => {
        const datasetText = Object.values(item.dataset || {}).join(' ');
        return normalize(`${datasetText} ${item.textContent || ''}`);
    };

    const getScope = (input) => {
        return input.closest('[data-live-search-scope]')
            || input.closest('main')
            || document.querySelector('main')
            || document.body;
    };

    const getItems = (scope) => {
        return Array.from(scope.querySelectorAll(SEARCHABLE_ITEM_SELECTOR))
            .filter((item, index, items) => items.indexOf(item) === index);
    };

    const getResultsContainer = (input, items) => {
        const explicit = input.closest('[data-live-search-scope]')?.querySelector('[data-live-search-results]');

        if (explicit) {
            return explicit;
        }

        const firstItem = items[0];

        if (!firstItem) {
            return input.closest('section') || input.form || input.parentElement;
        }

        return firstItem.closest('[data-service-grid], [data-products-grid], [data-promotions-list], .merchant-list, .merchant-grid, .service-catalog-grid, .products-marketplace-grid, tbody, table')
            || firstItem.parentElement
            || input.closest('section')
            || input.parentElement;
    };

    const getEmptyState = (container) => {
        const parent = container?.parentElement || container;

        if (!parent) {
            return null;
        }

        let empty = parent.querySelector(':scope > .live-search-empty');

        if (!empty) {
            empty = document.createElement('div');
            empty.className = 'live-search-empty';
            empty.hidden = true;
            empty.textContent = 'No results found.';

            if (container.tagName === 'TBODY') {
                container.closest('table')?.after(empty);
            } else {
                container.after(empty);
            }
        }

        return empty;
    };

    const applyLiveSearch = (input) => {
        const scope = getScope(input);
        const items = getItems(scope);

        if (items.length === 0) {
            return;
        }

        const container = getResultsContainer(input, items);
        const empty = getEmptyState(container);
        const query = normalize(input.value);
        let visibleCount = 0;

        items.forEach((item) => {
            const isVisible = query.length === 0 || getSearchText(item).includes(query);
            item.hidden = !isVisible;
            item.style.display = isVisible ? '' : 'none';

            if (isVisible) {
                visibleCount += 1;
            }
        });

        if (empty) {
            empty.hidden = visibleCount > 0;
        }

        scope.querySelectorAll('[data-live-search-count]').forEach((count) => {
            count.textContent = String(visibleCount);
        });
    };

    const initLiveSearch = () => {
        const inputs = Array.from(document.querySelectorAll('input[type="search"], [data-live-search-input]'));

        inputs.forEach((input) => {
            if (input.dataset.liveSearchReady === 'true') {
                return;
            }

            if (input.matches('[data-product-search], [data-location-search], [data-help-search]')) {
                return;
            }

            input.dataset.liveSearchReady = 'true';
            const handleInput = debounce(() => applyLiveSearch(input));

            input.addEventListener('input', handleInput);
            input.addEventListener('search', handleInput);

            if (normalize(input.value).length > 0) {
                applyLiveSearch(input);
            }
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLiveSearch, { once: true });
    } else {
        initLiveSearch();
    }
})();
