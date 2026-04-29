const fallbackServices = [
    {
        id: 9001,
        name: 'QR Test Booking Service',
        duration: '30 mins',
        price: 20,
        slots: ['9:00 AM', '12:30 PM', '6:30 PM'],
        options: [
            { id: 900101, name: 'Standard Test Booking', duration: '30 mins', price: 20, slots: ['9:00 AM', '12:30 PM', '6:30 PM'] }
        ]
    }
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
        services: fallbackServices.map((service) => ({ ...service }))
    };
}

const merchants = [
    {
        id: 1,
        name: 'Vaniday Beauty Studio',
        category: 'Beauty & Wellness',
        location: 'Orchard',
        qrToken: 'vaniday-beauty-studio-orchard',
        rating: '4.8',
        promotion: '20% off first booking',
        description: 'Hair styling, facials, and beauty treatments from trusted Vaniday merchants.',
        services: [
            {
                id: 101,
                name: 'Hair',
                duration: '45-90 mins',
                price: 35,
                slots: ['10:00 AM', '2:00 PM', '5:00 PM'],
                options: [
                    { id: 10101, name: 'Hair Cut', duration: '45 mins', price: 35, slots: ['10:00 AM', '2:00 PM', '5:00 PM'] },
                    { id: 10102, name: 'Hair Cut & Styling', duration: '60 mins', price: 45, slots: ['10:00 AM', '2:00 PM'] },
                    { id: 10103, name: 'Hair Colouring', duration: '90 mins', price: 88, slots: ['11:00 AM', '3:00 PM'] }
                ]
            },
            {
                id: 102,
                name: 'Facial',
                duration: '45-75 mins',
                price: 55,
                slots: ['11:00 AM', '3:30 PM'],
                options: [
                    { id: 10201, name: 'Express Facial', duration: '45 mins', price: 55, slots: ['11:00 AM', '3:30 PM'] },
                    { id: 10202, name: 'Hydrating Facial', duration: '60 mins', price: 68, slots: ['12:00 PM', '4:30 PM'] },
                    { id: 10203, name: 'Deep Cleansing Facial', duration: '75 mins', price: 78, slots: ['10:30 AM', '2:30 PM'] }
                ]
            },
            {
                id: 103,
                name: 'Nails',
                duration: '35-75 mins',
                price: 30,
                slots: ['12:00 PM', '4:00 PM'],
                options: [
                    { id: 10301, name: 'Manicure', duration: '40 mins', price: 35, slots: ['12:00 PM', '4:00 PM'] },
                    { id: 10302, name: 'Pedicure', duration: '45 mins', price: 38, slots: ['12:30 PM', '4:30 PM'] },
                    { id: 10303, name: 'Gel Manicure', duration: '60 mins', price: 55, slots: ['1:00 PM', '5:00 PM'] },
                    { id: 10304, name: 'Manicure & Pedicure', duration: '75 mins', price: 68, slots: ['11:30 AM', '3:30 PM'] }
                ]
            },
            {
                id: 104,
                name: 'QR Test Beauty Booking',
                duration: '30 mins',
                price: 20,
                slots: ['9:00 AM', '12:30 PM', '6:30 PM'],
                options: [
                    { id: 10401, name: 'Standard Beauty Booking', duration: '30 mins', price: 20, slots: ['9:00 AM', '12:30 PM', '6:30 PM'] }
                ]
            }
        ]
    },
    {
        id: 2,
        name: 'FreshGlow Spa',
        category: 'Spa',
        location: 'Tampines',
        qrToken: 'freshglow-spa-tampines',
        rating: '4.6',
        promotion: 'Free add-on massage for bookings above $80',
        description: 'Relaxing spa services with simple online booking and clear appointment slots.',
        services: [
            {
                id: 201,
                name: 'Massage',
                duration: '60-90 mins',
                price: 78,
                slots: ['9:30 AM', '1:00 PM', '6:00 PM'],
                options: [
                    { id: 20101, name: 'Aromatherapy Massage', duration: '90 mins', price: 98, slots: ['9:30 AM', '1:00 PM', '6:00 PM'] },
                    { id: 20102, name: 'Swedish Massage', duration: '60 mins', price: 78, slots: ['10:30 AM', '2:30 PM'] },
                    { id: 20103, name: 'Deep Tissue Massage', duration: '75 mins', price: 88, slots: ['11:30 AM', '5:00 PM'] }
                ]
            },
            {
                id: 202,
                name: 'Body Treatment',
                duration: '45-75 mins',
                price: 65,
                slots: ['10:30 AM', '4:30 PM'],
                options: [
                    { id: 20201, name: 'Body Scrub', duration: '60 mins', price: 72, slots: ['10:30 AM', '4:30 PM'] },
                    { id: 20202, name: 'Body Wrap', duration: '75 mins', price: 86, slots: ['11:00 AM', '3:00 PM'] },
                    { id: 20203, name: 'Foot Reflexology', duration: '45 mins', price: 48, slots: ['12:00 PM', '6:00 PM'] }
                ]
            }
        ]
    },
    {
        id: 3,
        name: 'Urban Groom Barbers',
        category: 'Barber',
        location: 'Woodlands',
        qrToken: 'urban-groom-barbers-woodlands',
        rating: '4.7',
        promotion: '$5 student discount',
        description: 'Fast grooming services for walk-in style retail merchants using digital booking.',
        services: [
            {
                id: 301,
                name: 'Haircut',
                duration: '25-45 mins',
                price: 25,
                slots: ['10:00 AM', '1:30 PM', '7:00 PM'],
                options: [
                    { id: 30101, name: 'Classic Haircut', duration: '30 mins', price: 28, slots: ['10:00 AM', '1:30 PM', '7:00 PM'] },
                    { id: 30102, name: 'Skin Fade', duration: '45 mins', price: 38, slots: ['11:00 AM', '2:30 PM'] },
                    { id: 30103, name: 'Student Haircut', duration: '25 mins', price: 22, slots: ['12:00 PM', '6:30 PM'] }
                ]
            },
            {
                id: 302,
                name: 'Beard',
                duration: '20-40 mins',
                price: 18,
                slots: ['11:30 AM', '3:00 PM'],
                options: [
                    { id: 30201, name: 'Beard Trim', duration: '20 mins', price: 18, slots: ['11:30 AM', '3:00 PM'] },
                    { id: 30202, name: 'Beard Shape & Line Up', duration: '30 mins', price: 25, slots: ['12:30 PM', '4:00 PM'] },
                    { id: 30203, name: 'Hot Towel Shave', duration: '40 mins', price: 32, slots: ['10:30 AM', '5:30 PM'] }
                ]
            }
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

function hasValidQrToken(merchant, qrToken) {
    return Boolean(merchant && merchant.qrToken && merchant.qrToken === qrToken);
}

module.exports = {
    getAll,
    findById,
    findService,
    hasValidQrToken
};
