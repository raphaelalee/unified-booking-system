const MERCHANT_NAVIGATION = [
    ['analytics', '/merchant/analytics'],
    ['booking', '/merchant/bookings'],
    ['bookings', '/merchant/bookings'],
    ['refund', '/help-center'],
    ['refunds', '/help-center'],
    ['inventory', '/merchant/products'],
    ['product', '/merchant/products'],
    ['products', '/merchant/products'],
    ['service', '/merchant/services'],
    ['services', '/merchant/services'],
    ['spin', '/merchant/spin-discover'],
    ['wheel', '/merchant/spin-discover'],
    ['promotion', '/merchant/promotions'],
    ['promotions', '/merchant/promotions'],
    ['voucher', '/merchant/vouchers'],
    ['wallet', '/merchant/wallet'],
    ['profile', '/merchant/profile'],
    ['dashboard', '/merchant/dashboard']
];

const ADMIN_NAVIGATION = [
    ['analytics', '/admin/analytics'],
    ['merchant management', '/admin/merchants'],
    ['merchant', '/admin/merchants'],
    ['merchants', '/admin/merchants'],
    ['user', '/admin/users'],
    ['users', '/admin/users'],
    ['booking', '/admin/bookings'],
    ['bookings', '/admin/bookings'],
    ['refund', '/admin/reports'],
    ['refunds', '/admin/reports'],
    ['review', '/admin/reviews'],
    ['reviews', '/admin/reviews'],
    ['service', '/admin/services'],
    ['services', '/admin/services'],
    ['product', '/admin/products'],
    ['products', '/admin/products'],
    ['spin', '/admin/reward-shop-vouchers'],
    ['reward', '/admin/reward-shop-vouchers'],
    ['rewards', '/admin/reward-shop-vouchers'],
    ['report', '/admin/reports'],
    ['reports', '/admin/reports'],
    ['dashboard', '/admin/dashboard']
];

function resolveAiNavigation({ role, question = '', intent = '' }) {
    if (!/navigation$/.test(intent) && !/\b(open|go to|navigate|take me to|show page|manage)\b/i.test(question)) {
        return null;
    }

    const normalized = String(question || '').toLowerCase();
    const table = role === 'admin' ? ADMIN_NAVIGATION : MERCHANT_NAVIGATION;
    const match = table.find(([keyword]) => normalized.includes(keyword));

    if (!match) return null;

    return {
        label: `Open ${match[0]}`,
        href: match[1],
        requiresConfirmation: true
    };
}

module.exports = {
    resolveAiNavigation
};
