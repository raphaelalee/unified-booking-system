function getCartQuantity(item) {
    const quantity = Number(item?.quantity || 1);

    if (!Number.isFinite(quantity)) {
        return 1;
    }

    return Math.max(1, Math.min(Math.floor(quantity), 99));
}

function getCartItemCount(cart = []) {
    return cart.reduce((count, item) => {
        return count + (item.type === 'Product' ? getCartQuantity(item) : 1);
    }, 0);
}

function getCartLineTotal(item) {
    return Number(item?.price || 0) * getCartQuantity(item);
}

module.exports = {
    getCartQuantity,
    getCartItemCount,
    getCartLineTotal
};
