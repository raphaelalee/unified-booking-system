(function () {
    const CART_KEY = 'vanidayProductCart';
    const DELIVERY_FEE = 5;
    const merchants = [
        'Vaniday Beauty Studio - Orchard',
        'FreshGlow Spa - Tampines',
        'Urban Groom Barbers - Woodlands',
        'Marina Square Support Counter'
    ];

    const mount = document.getElementById('browser-product-cart');
    const emptyState = document.getElementById('empty-cart-state');
    let products = readProducts();
    let fulfilment = localStorage.getItem('vanidayFulfilment') || 'pickup';
    let pickupMerchant = localStorage.getItem('vanidayPickupMerchant') || merchants[0];

    if (!mount) {
        return;
    }

    if (products.length === 0) {
        return;
    }

    if (emptyState) {
        emptyState.style.display = 'none';
    }

    render();

    function render() {
        const subtotal = products.reduce((sum, item) => {
            return sum + Number(item.price || 0) * Number(item.quantity || 1);
        }, 0);
        const deliveryFee = fulfilment === 'delivery' ? DELIVERY_FEE : 0;
        const total = subtotal + deliveryFee;

        mount.innerHTML = `
            <div class="cart-layout browser-cart-layout">
                <div class="cart-list">
                    ${products.map((item) => renderProduct(item)).join('')}
                </div>

                <aside class="booking-panel cart-summary-panel">
                    <p class="eyebrow">Checkout options</p>
                    <h2>Collect or deliver</h2>

                    <div class="fulfilment-options" role="radiogroup" aria-label="Cart fulfilment">
                        <label class="fulfilment-choice ${fulfilment === 'pickup' ? 'active' : ''}">
                            <input type="radio" name="fulfilment" value="pickup" ${fulfilment === 'pickup' ? 'checked' : ''}>
                            <span>
                                <strong>Pick up</strong>
                                <small>Collect at any merchant</small>
                            </span>
                        </label>
                        <label class="fulfilment-choice ${fulfilment === 'delivery' ? 'active' : ''}">
                            <input type="radio" name="fulfilment" value="delivery" ${fulfilment === 'delivery' ? 'checked' : ''}>
                            <span>
                                <strong>Delivery</strong>
                                <small>$${DELIVERY_FEE.toFixed(2)} delivery fee</small>
                            </span>
                        </label>
                    </div>

                    <label class="pickup-field ${fulfilment === 'delivery' ? 'is-hidden' : ''}">
                        Pick up merchant
                        <select id="pickup-merchant">
                            ${merchants.map((merchant) => `
                                <option value="${escapeAttr(merchant)}" ${merchant === pickupMerchant ? 'selected' : ''}>
                                    ${escapeHtml(merchant)}
                                </option>
                            `).join('')}
                        </select>
                    </label>

                    <label class="delivery-field ${fulfilment === 'pickup' ? 'is-hidden' : ''}">
                        Delivery address
                        <input type="text" placeholder="Enter delivery address">
                    </label>

                    <div class="cart-totals">
                        <p><span>Subtotal</span><strong>$${subtotal.toFixed(2)}</strong></p>
                        <p><span>Delivery fee</span><strong>$${deliveryFee.toFixed(2)}</strong></p>
                        <p class="cart-total-line"><span>Total</span><strong>$${total.toFixed(2)}</strong></p>
                    </div>

                    <p class="muted">${itemCount()} item${itemCount() === 1 ? '' : 's'} selected</p>
                    <a class="button secondary full" href="/payment?amount=${encodeURIComponent(total.toFixed(2))}&service=${encodeURIComponent('Product checkout')}&merchant=${encodeURIComponent(fulfilment === 'pickup' ? pickupMerchant : 'Delivery')}">Checkout and pay</a>
                    <button class="text-button full" type="button" id="clear-browser-products">Clear products</button>
                </aside>
            </div>
        `;

        bindEvents();
    }

    function renderProduct(item) {
        const quantity = Number(item.quantity || 1);
        const lineTotal = Number(item.price || 0) * quantity;

        return `
            <article class="cart-item product-cart-item">
                <div class="cart-item-copy">
                    <p class="eyebrow">Product &middot; ${escapeHtml(item.merchantName)}</p>
                    <h2>${escapeHtml(item.serviceName)}</h2>
                    <p class="muted">${escapeHtml(item.duration)} &middot; $${Number(item.price || 0).toFixed(2)} each</p>
                    <p class="line-total">Item total: $${lineTotal.toFixed(2)}</p>
                </div>
                <div class="cart-item-actions">
                    <div class="cart-quantity-controls" aria-label="Edit quantity for ${escapeAttr(item.serviceName)}">
                        <button class="quantity-button" type="button" data-quantity-change="${escapeAttr(item.id)}" data-direction="-1" aria-label="Decrease quantity">-</button>
                        <input class="quantity-input" type="number" min="1" value="${quantity}" data-quantity-input="${escapeAttr(item.id)}" aria-label="Quantity">
                        <button class="quantity-button" type="button" data-quantity-change="${escapeAttr(item.id)}" data-direction="1" aria-label="Increase quantity">+</button>
                    </div>
                    <button class="button secondary" type="button" data-edit-product="${escapeAttr(item.id)}">Update amount</button>
                    <button class="text-button" type="button" data-remove-product="${escapeAttr(item.id)}">Delete</button>
                </div>
            </article>
        `;
    }

    function bindEvents() {
        mount.querySelectorAll('[data-quantity-change]').forEach((button) => {
            button.addEventListener('click', () => {
                const id = button.getAttribute('data-quantity-change');
                const direction = Number(button.getAttribute('data-direction'));
                updateQuantity(id, (current) => Math.max(1, current + direction));
            });
        });

        mount.querySelectorAll('[data-quantity-input]').forEach((input) => {
            input.addEventListener('change', () => {
                const id = input.getAttribute('data-quantity-input');
                updateQuantity(id, () => Math.max(1, Number(input.value || 1)));
            });
        });

        mount.querySelectorAll('[data-edit-product]').forEach((button) => {
            button.addEventListener('click', () => {
                const id = button.getAttribute('data-edit-product');
                const input = mount.querySelector(`[data-quantity-input="${cssEscape(id)}"]`);
                if (input) {
                    updateQuantity(id, () => Math.max(1, Number(input.value || 1)));
                }
            });
        });

        mount.querySelectorAll('[data-remove-product]').forEach((button) => {
            button.addEventListener('click', () => {
                const id = button.getAttribute('data-remove-product');
                products = products.filter((item) => item.id !== id);
                saveProducts();
                if (products.length === 0) {
                    window.location.reload();
                    return;
                }
                render();
            });
        });

        mount.querySelectorAll('input[name="fulfilment"]').forEach((radio) => {
            radio.addEventListener('change', () => {
                fulfilment = radio.value;
                localStorage.setItem('vanidayFulfilment', fulfilment);
                render();
            });
        });

        const pickupSelect = document.getElementById('pickup-merchant');
        if (pickupSelect) {
            pickupSelect.addEventListener('change', () => {
                pickupMerchant = pickupSelect.value;
                localStorage.setItem('vanidayPickupMerchant', pickupMerchant);
                render();
            });
        }

        const clearButton = document.getElementById('clear-browser-products');
        if (clearButton) {
            clearButton.addEventListener('click', () => {
                localStorage.removeItem(CART_KEY);
                window.location.reload();
            });
        }
    }

    function updateQuantity(id, getNextQuantity) {
        products = products.map((item) => {
            if (item.id !== id) {
                return item;
            }
            return {
                ...item,
                quantity: getNextQuantity(Number(item.quantity || 1))
            };
        });
        saveProducts();
        render();
    }

    function itemCount() {
        return products.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
    }

    function readProducts() {
        return JSON.parse(localStorage.getItem(CART_KEY) || '[]').map((item) => ({
            ...item,
            quantity: Math.max(1, Number(item.quantity || 1))
        }));
    }

    function saveProducts() {
        localStorage.setItem(CART_KEY, JSON.stringify(products));
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#096;');
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }
        return String(value).replace(/"/g, '\\"');
    }
})();
