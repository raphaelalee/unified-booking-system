const fallbackServices = [
    { id: 9001, name: 'QR Test Booking Service', duration: '30 mins', price: 20, slots: ['9:00 AM', '12:30 PM', '6:30 PM'] }
];

function withServices(merchant) {
    if (!merchant) {
        return null;
    }

    if (Array.isArray(merchant.services) && merchant.services.length > 0) {
        return merchant;
    }

    return {
        ...merchant,
        services: fallbackServices
    };
}

const merchants = [
    {
        id: 1,
        name: 'Vaniday Beauty Studio',
        category: 'Beauty & Wellness',
        location: 'Orchard',
        rating: '4.8',
        promotion: '20% off first booking',
        description: 'Hair styling, facials, and beauty treatments from trusted Vaniday merchants.',
        services: [
            { id: 101, name: 'Hair Cut & Styling', duration: '60 mins', price: 45, slots: ['10:00 AM', '2:00 PM', '5:00 PM'] },
            { id: 102, name: 'Express Facial', duration: '45 mins', price: 55, slots: ['11:00 AM', '3:30 PM'] },
            { id: 103, name: 'Manicure', duration: '40 mins', price: 35, slots: ['12:00 PM', '4:00 PM'] },
            { id: 104, name: 'QR Test Beauty Booking', duration: '30 mins', price: 20, slots: ['9:00 AM', '12:30 PM', '6:30 PM'] }
        ]
    },
    {
        id: 2,
        name: 'FreshGlow Spa',
        category: 'Spa',
        location: 'Tampines',
        rating: '4.6',
        promotion: 'Free add-on massage for bookings above $80',
        description: 'Relaxing spa services with simple online booking and clear appointment slots.',
        services: [
            { id: 201, name: 'Aromatherapy Massage', duration: '90 mins', price: 98, slots: ['9:30 AM', '1:00 PM', '6:00 PM'] },
            { id: 202, name: 'Body Scrub', duration: '60 mins', price: 72, slots: ['10:30 AM', '4:30 PM'] }
        ]
    },
    {
        id: 3,
        name: 'Urban Groom Barbers',
        category: 'Barber',
        location: 'Woodlands',
        rating: '4.7',
        promotion: '$5 student discount',
        description: 'Fast grooming services for walk-in style retail merchants using digital booking.',
        services: [
            { id: 301, name: 'Classic Haircut', duration: '30 mins', price: 28, slots: ['10:00 AM', '1:30 PM', '7:00 PM'] },
            { id: 302, name: 'Beard Trim', duration: '20 mins', price: 18, slots: ['11:30 AM', '3:00 PM'] }
        ]
    }
];

function getAll(searchTerm = '') {
    const search = searchTerm.trim().toLowerCase();

    if (!search) {
        return merchants.map(withServices);
    }

    return merchants.filter((merchant) => {
        const services = Array.isArray(merchant.services) ? merchant.services : fallbackServices;
        const searchableText = [
            merchant.name,
            merchant.category,
            merchant.location,
            merchant.description,
            merchant.promotion,
            ...services.flatMap((service) => [
                service.name,
                service.duration,
                String(service.price),
                ...(service.slots || [])
            ])
        ].join(' ').toLowerCase();

        return searchableText.includes(search);
    }).map(withServices);
}

function findById(id) {
    return withServices(merchants.find((merchant) => merchant.id === Number(id)));
}

function findService(merchantId, serviceId) {
    const merchant = findById(merchantId);

    if (!merchant) {
        return null;
    }

    return merchant.services.find((service) => service.id === Number(serviceId)) || null;
}

module.exports = {
    getAll,
    findById,
    findService
};
