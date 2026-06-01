# Featured Marketplace Walkthrough

## Overview

The featured marketplace feature has 3 layers:

1. database columns and seed data
2. merchant/admin management actions
3. public storefront rendering

It supports:

- featured salons
- featured services
- featured products

## 1. Database Layer

The schema migration is in [database/20260601_featured_marketplace.sql](</d:/2026 sem 1/C300 FYP/unified-booking-system/database/20260601_featured_marketplace.sql>).

### `salons`

Added fields:

- `is_featured`
- `featured_type`
- `featured_order`
- `featured_start_date`
- `featured_end_date`
- `featured_score`

### `services`

Added fields:

- `is_featured`
- `featured_order`
- `featured_start_date`
- `featured_end_date`

### `products`

Added fields:

- `is_featured`
- `featured_order`
- `featured_start_date`
- `featured_end_date`

The SQL file also includes sample `UPDATE` statements to mark example salons, services, and products as featured.

## 2. Model Layer

### Merchant + service featured logic

[models/MerchantService.js](</d:/2026 sem 1/C300 FYP/unified-booking-system/models/MerchantService.js>)

This model handles both:

- featured salon logic
- featured service logic

Important methods:

- `getFeaturedMerchants(callback)`
- `getFeaturedServices(callback)`
- `getFeaturedServicesByMerchant(merchantId, callback)`
- `markServiceFeatured(userId, serviceId, payload, callback)`
- `removeServiceFeatured(userId, serviceId, callback)`
- `markMerchantFeatured(salonId, payload, callback)`
- `removeMerchantFeatured(salonId, callback)`

Important rules inside the model:

- only currently active featured rows are returned
- date window is enforced with start/end date
- featured services per merchant are capped at 3
- featured merchant types are normalized to:
  - `featured_month`
  - `sponsored`
  - `trending`
  - `top_rated`
- featured merchant score is stored in `featured_score`

### Product featured logic

[models/Product.js](</d:/2026 sem 1/C300 FYP/unified-booking-system/models/Product.js>)

Important methods:

- `getFeaturedProducts(callback)`
- `getFeaturedProductsByMerchant(merchantId, callback)`
- `markProductFeatured(userId, productId, payload, callback)`
- `removeProductFeatured(userId, productId, callback)`

Important rules:

- only active featured products inside valid date windows are returned
- featured products per merchant are capped at 3

## 3. Controller Layer

### Public storefront loading

[controllers/merchantController.js](</d:/2026 sem 1/C300 FYP/unified-booking-system/controllers/merchantController.js>)

This controller is where featured content is merged into public pages.

Important helper functions:

- `mergeFeaturedMerchantRows(...)`
- `sortMerchantsByFeatured(...)`
- `sortServicesByFeatured(...)`
- `sortProductsByFeatured(...)`

Important public usage points:

- home page loads featured merchants, services, and products
- merchants listing sorts and labels featured salons
- merchant detail highlights featured services and products
- booking page shows featured recommended services
- payment page shows featured product upsell cards

Important render data used by views:

- `featuredMerchants`
- `featuredMerchantOfMonth`
- `trendingMerchants`
- `featuredServices`
- `featuredProducts`
- `featuredRecommendedServices`
- `featuredProductsUpsell`

### Merchant dashboard actions

[controllers/merchantDashboardController.js](</d:/2026 sem 1/C300 FYP/unified-booking-system/controllers/merchantDashboardController.js>)

Merchant actions:

- feature service
- unfeature service
- feature product
- unfeature product

Controller methods:

- service feature actions around `markServiceFeatured(...)`
- product feature actions around `markProductFeatured(...)`

These validate the submitted feature order and date range before calling the model.

### Admin actions

[controllers/adminController.js](</d:/2026 sem 1/C300 FYP/unified-booking-system/controllers/adminController.js>)

Admin controls featured salons.

Important actions:

- feature merchant
- unfeature merchant

These call:

- `MerchantService.markMerchantFeatured(...)`
- `MerchantService.removeMerchantFeatured(...)`

## 4. Routes

[app.js](</d:/2026 sem 1/C300 FYP/unified-booking-system/app.js>)

Important routes already wired:

- `GET /promotions/featured-salons`
- merchant feature/unfeature service routes
- merchant feature/unfeature product routes
- admin feature/unfeature merchant routes

## 5. View Layer

### Public pages

Featured content is rendered in:

- [views/home.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/home.ejs>)
- [views/merchants.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/merchants.ejs>)
- [views/merchant-detail.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/merchant-detail.ejs>)
- [views/services.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/services.ejs>)
- [views/products.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/products.ejs>)
- [views/booking.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/booking.ejs>)
- [views/payment.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/payment.ejs>)
- [views/featured-salons.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/featured-salons.ejs>)

### Merchant dashboard pages

Merchant can manage featured items in:

- [views/merchant-services.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/merchant-services.ejs>)
- [views/merchant-products.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/merchant-products.ejs>)

### Admin page

Admin manages featured salons in:

- [views/admin-merchants.ejs](</d:/2026 sem 1/C300 FYP/unified-booking-system/views/admin-merchants.ejs>)

## 6. Business Rules

### Featured salons

- controlled by admin
- can carry a `featured_type`
- support date windows
- can be sorted by `featured_order`
- can be ranked by `featured_score`

### Featured services

- controlled by merchant
- merchant can feature up to 3 services
- support date windows
- sorted by `featured_order`

### Featured products

- controlled by merchant
- merchant can feature up to 3 products
- support date windows
- sorted by `featured_order`

## 7. Public Behavior

Only rows inside the active featured window are shown:

- `is_featured = 1`
- `featured_start_date <= today` or null
- `featured_end_date >= today` or null

That means expired featured salons, services, or products stop appearing automatically without manual cleanup.

## 8. Suggested Demo Flow

1. Run [database/20260601_featured_marketplace.sql](</d:/2026 sem 1/C300 FYP/unified-booking-system/database/20260601_featured_marketplace.sql>).
2. Check featured sample rows in MySQL.
3. Open `/`.
4. Open `/merchants`.
5. Open one merchant detail page.
6. Open merchant dashboard services/products.
7. Open admin merchants page.

## 9. Quick Verification Queries

```sql
SELECT salon_id, salon_name, is_featured, featured_type, featured_order, featured_score
FROM salons
ORDER BY featured_order, salon_id;

SELECT service_id, salon_id, service_name, is_featured, featured_order, featured_start_date, featured_end_date
FROM services
ORDER BY featured_order, service_id;

SELECT product_id, salon_id, name, is_featured, featured_order, featured_start_date, featured_end_date
FROM products
ORDER BY featured_order, product_id;
```
