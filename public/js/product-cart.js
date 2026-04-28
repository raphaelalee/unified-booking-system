(function () {
    const forms = document.querySelectorAll('.product-add-form');

    forms.forEach((form) => {
        form.addEventListener('submit', (event) => {
            event.preventDefault();

            const formData = new FormData(form);
            const product = {
                id: `${formData.get('productId')}-${Date.now()}`,
                type: 'Product',
                merchantName: formData.get('productCategory'),
                serviceName: formData.get('productName'),
                duration: formData.get('productDescription'),
                price: Number(formData.get('productPrice')),
                quantity: 1
            };

            const cart = JSON.parse(localStorage.getItem('vanidayProductCart') || '[]');
            cart.push(product);
            localStorage.setItem('vanidayProductCart', JSON.stringify(cart));

            window.location.href = '/cart';
        });
    });
})();
