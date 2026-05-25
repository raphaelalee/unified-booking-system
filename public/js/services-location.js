(function () {
    const AREA_COORDS = [
        { key: 'orchard', lat: 1.3048, lng: 103.8318 },
        { key: 'tampines', lat: 1.3526, lng: 103.9448 },
        { key: 'woodlands', lat: 1.4360, lng: 103.7860 },
        { key: 'jurong', lat: 1.3329, lng: 103.7436 },
        { key: 'bugis', lat: 1.3006, lng: 103.8565 },
        { key: 'novena', lat: 1.3205, lng: 103.8439 },
        { key: 'serangoon', lat: 1.3496, lng: 103.8737 },
        { key: 'bishan', lat: 1.3508, lng: 103.8485 },
        { key: 'paya lebar', lat: 1.3182, lng: 103.8931 },
        { key: 'clementi', lat: 1.3151, lng: 103.7652 },
        { key: 'queenstown', lat: 1.2942, lng: 103.7861 },
        { key: 'raffles', lat: 1.2839, lng: 103.8515 },
        { key: 'city hall', lat: 1.2931, lng: 103.8521 }
    ];

    function toRadians(value) {
        return value * Math.PI / 180;
    }

    function distanceKm(origin, destination) {
        const earthKm = 6371;
        const dLat = toRadians(destination.lat - origin.lat);
        const dLng = toRadians(destination.lng - origin.lng);
        const lat1 = toRadians(origin.lat);
        const lat2 = toRadians(destination.lat);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

        return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function findCoords(text) {
        const normalized = String(text || '').toLowerCase();
        return AREA_COORDS.find((entry) => normalized.includes(entry.key)) || null;
    }

    function setupServicesLocation() {
        const section = document.querySelector('[data-services-location-section]');
        const grid = document.querySelector('[data-service-grid]');

        if (!section || !grid) {
            return;
        }

        const allowButton = section.querySelector('[data-allow-location]');
        const status = section.querySelector('[data-location-status]');
        const searchWrap = section.querySelector('[data-location-search-wrap]');
        const searchInput = section.querySelector('[data-location-search]');
        const cards = Array.from(grid.querySelectorAll('[data-service-card]'));
        const debounce = (callback, delay = 240) => {
            let timer = null;

            return (...args) => {
                window.clearTimeout(timer);
                timer = window.setTimeout(() => callback(...args), delay);
            };
        };

        const setStatus = (message) => {
            if (status) {
                status.textContent = message;
            }
        };

        const showSearch = () => {
            if (searchWrap) {
                searchWrap.hidden = false;
            }
        };

        const applyLocationSearch = () => {
            const query = String(searchInput?.value || '').trim().toLowerCase();

            cards.forEach((card) => {
                const haystack = [
                    card.dataset.merchantLocation,
                    card.dataset.merchantName,
                    card.dataset.serviceName,
                    card.dataset.category
                ].join(' ').toLowerCase();
                card.hidden = Boolean(query) && !haystack.includes(query);
            });
        };

        const sortByDistance = (position) => {
            const origin = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            const ranked = cards.map((card) => {
                const coords = findCoords(card.dataset.merchantLocation);
                const distance = coords ? distanceKm(origin, coords) : Number.POSITIVE_INFINITY;
                return { card, distance };
            }).sort((left, right) => left.distance - right.distance);

            ranked.forEach((item, index) => {
                const label = item.card.querySelector('[data-distance-label]');
                const nearest = item.card.querySelector('[data-nearest-label]');

                if (Number.isFinite(item.distance)) {
                    item.card.dataset.distanceKm = item.distance.toFixed(1);
                    if (label) {
                        label.textContent = `${item.distance.toFixed(1)} km away`;
                        label.hidden = false;
                    }
                    if (nearest) {
                        nearest.hidden = index !== 0;
                    }
                }

                grid.appendChild(item.card);
            });

            section.classList.add('has-location');
            setStatus('Showing nearest salons first.');
        };

        allowButton?.addEventListener('click', () => {
            if (!navigator.geolocation) {
                setStatus('Location is not available in this browser.');
                showSearch();
                return;
            }

            setStatus('Requesting location permission...');
            navigator.geolocation.getCurrentPosition(
                sortByDistance,
                () => {
                    setStatus('Location permission was not allowed. Browse normally or search by area.');
                    showSearch();
                },
                { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
            );
        });

        searchInput?.addEventListener('input', debounce(applyLocationSearch));
    }

    setupServicesLocation();
}());
