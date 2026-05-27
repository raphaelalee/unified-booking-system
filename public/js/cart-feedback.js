(() => {
    const CART_FORM_SELECTOR = [
        'form.product-add-form',
        'form[action^="/cart/add/"]'
    ].join(',');
    let toastTimer = null;

    const getToast = () => {
        let toast = document.querySelector('[data-cart-toast]');

        if (toast) {
            return toast;
        }

        toast = document.createElement('div');
        toast.className = 'cart-toast';
        toast.setAttribute('data-cart-toast', '');
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        toast.hidden = true;
        document.body.appendChild(toast);
        return toast;
    };

    const showToast = (message, isError = false) => {
        const toast = getToast();
        toast.textContent = message || (isError ? 'Cart could not be updated.' : 'Item added to cart.');
        toast.classList.toggle('is-error', isError);
        toast.hidden = false;
        requestAnimationFrame(() => toast.classList.add('is-visible'));

        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => {
            toast.classList.remove('is-visible');
            window.setTimeout(() => {
                toast.hidden = true;
            }, 180);
        }, 2600);
    };

    const updateCartCounts = (cartCount) => {
        if (!Number.isFinite(Number(cartCount))) {
            return;
        }

        document.querySelectorAll('[data-cart-count], .bag-count, .marketplace-cart-link strong').forEach((element) => {
            element.textContent = String(cartCount);
        });
    };

    const setButtonBusy = (button, isBusy) => {
        if (!button) {
            return;
        }

        if (isBusy) {
            button.dataset.originalText = button.textContent;
            button.disabled = true;
            button.textContent = 'Adding...';
            return;
        }

        button.disabled = false;
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
    };

    document.addEventListener('submit', async (event) => {
        const form = event.target.closest(CART_FORM_SELECTOR);

        if (!form || form.dataset.cartAjax === 'off') {
            return;
        }

        event.preventDefault();

        const submitButton = form.querySelector('button[type="submit"]');
        const formData = new FormData(form);
        formData.set('responseType', 'json');
        const body = new URLSearchParams();
        formData.forEach((value, key) => {
            body.append(key, value);
        });
        setButtonBusy(submitButton, true);

        try {
            const response = await fetch(form.action, {
                method: String(form.method || 'POST').toUpperCase(),
                body,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                }
            });
            const contentType = response.headers.get('content-type') || '';

            if (!contentType.includes('application/json')) {
                window.location.href = response.url || '/cart';
                return;
            }

            const data = await response.json();

            if (response.status === 401 && data.redirectUrl) {
                window.location.href = data.redirectUrl;
                return;
            }

            if (!response.ok || !data.success) {
                showToast(data.message || 'Cart could not be updated.', true);
                return;
            }

            updateCartCounts(data.cartCount);
            showToast(data.message || 'Item added to cart.');
        } catch (error) {
            showToast('Cart could not be updated. Please try again.', true);
        } finally {
            setButtonBusy(submitButton, false);
        }
    });
})();
