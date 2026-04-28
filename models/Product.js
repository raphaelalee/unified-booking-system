const products = [
    { id: 'skin-serum', name: 'Hydrating Glow Serum', category: 'Skincare', price: 38, description: 'Best after facial treatments' },
    { id: 'hair-mask', name: 'Repair Hair Mask', category: 'Haircare', price: 32, description: 'For coloured or dry hair' },
    { id: 'body-oil', name: 'Calming Body Oil', category: 'Bodycare', price: 28, description: 'Spa-inspired daily care' },
    { id: 'lip-tint', name: 'Soft Rose Lip Tint', category: 'Makeup', price: 18, description: 'Lightweight everyday colour' },
    { id: 'cream-cleanser', name: 'Gentle Cream Cleanser', category: 'Skincare', price: 24, description: 'For daily cleansing after facials' },
    { id: 'room-mist', name: 'Botanical Room Mist', category: 'Wellness', price: 22, description: 'Calm spa scent for home' }
];

function getAll() {
    return products;
}

function findById(id) {
    return products.find((product) => product.id === id) || null;
}

module.exports = {
    getAll,
    findById
};
