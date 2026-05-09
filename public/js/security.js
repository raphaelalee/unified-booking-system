(() => {
    const token = document.querySelector('meta[name="csrf-token"]')?.content || '';

    if (!token) {
        return;
    }

    const isUnsafeMethod = (method) => !['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
    const isSameOrigin = (input) => {
        try {
            const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
            return url.origin === window.location.origin;
        } catch (error) {
            return true;
        }
    };

    const securePostForms = () => {
        document.querySelectorAll('form').forEach((form) => {
            const method = String(form.getAttribute('method') || 'GET').toUpperCase();

            if (!isUnsafeMethod(method) || form.querySelector('input[name="_csrf"]')) {
                return;
            }

            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = '_csrf';
            input.value = token;
            form.appendChild(input);
        });
    };

    securePostForms();

    const observer = new MutationObserver(securePostForms);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    if (typeof window.fetch === 'function') {
        const originalFetch = window.fetch.bind(window);

        window.fetch = (input, init = {}) => {
            const method = init.method || (typeof input !== 'string' ? input.method : 'GET');

            if (isUnsafeMethod(method) && isSameOrigin(input)) {
                const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
                headers.set('X-CSRF-Token', token);
                init = { ...init, headers };
            }

            return originalFetch(input, init);
        };
    }
})();
