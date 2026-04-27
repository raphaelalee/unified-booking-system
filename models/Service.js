const Merchant = require('./Merchant');

function getByMerchant(merchantId) {
    const merchant = Merchant.findById(merchantId);
    return merchant ? merchant.services : [];
}

function findByMerchant(merchantId, serviceId) {
    return Merchant.findService(merchantId, serviceId);
}

module.exports = {
    getByMerchant,
    findByMerchant
};
