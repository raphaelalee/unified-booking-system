# AI endpoint Postman examples

All POST requests require an authenticated session cookie and the normal `x-csrf-token` header used by the app.

Base URL: `http://localhost:3000`

## 1. Normal negative review, should be approved

POST `/api/ai/moderate-review-text`

```json
{
  "reviewText": "The haircut was shorter than I asked for, but the salon was clean and the staff were polite.",
  "rating": 3,
  "merchantName": "Vaniday Beauty Studio",
  "serviceName": "Ladies Haircut",
  "verifiedBooking": true,
  "completedBooking": true,
  "previousReviewCount": 2,
  "duplicateTextCount": 0
}
```

## 2. Profanity review

POST `/api/ai/moderate-review-text`

```json
{
  "reviewText": "This was a damn terrible haircut.",
  "rating": 1,
  "merchantName": "Vaniday Beauty Studio",
  "serviceName": "Ladies Haircut",
  "verifiedBooking": true,
  "completedBooking": true,
  "previousReviewCount": 1,
  "duplicateTextCount": 0
}
```

## 3. Harassment review

POST `/api/ai/moderate-review-text`

```json
{
  "reviewText": "The stylist is disgusting and should be fired. Everyone should insult her.",
  "rating": 1,
  "merchantName": "Vaniday Beauty Studio",
  "serviceName": "Hair Colour",
  "verifiedBooking": true,
  "completedBooking": true,
  "previousReviewCount": 1,
  "duplicateTextCount": 0
}
```

## 4. Spam advertisement review

POST `/api/ai/moderate-review-text`

```json
{
  "reviewText": "Best cheap beauty deals visit www.example.com or WhatsApp 91234567 now promo code FREE",
  "rating": 5,
  "merchantName": "Vaniday Beauty Studio",
  "serviceName": "Facial",
  "verifiedBooking": false,
  "completedBooking": false,
  "previousReviewCount": 0,
  "duplicateTextCount": 0
}
```

## 5. Duplicate suspicious review

POST `/api/ai/moderate-review-text`

```json
{
  "reviewText": "Amazing amazing amazing amazing amazing",
  "rating": 5,
  "merchantName": "Vaniday Beauty Studio",
  "serviceName": "Facial",
  "verifiedBooking": true,
  "completedBooking": true,
  "previousReviewCount": 12,
  "duplicateTextCount": 4
}
```

## 6. Safe and relevant salon image

POST `/api/ai/moderate-review-image`

```json
{
  "imageUrl": "https://example.com/review-haircut-result.jpg",
  "merchantCategory": "Hair salon",
  "serviceName": "Ladies Haircut",
  "reviewText": "The haircut result looked neat."
}
```

## 7. Unrelated food image

POST `/api/ai/moderate-review-image`

```json
{
  "imageUrl": "https://example.com/burger-photo.jpg",
  "merchantCategory": "Hair salon",
  "serviceName": "Ladies Haircut",
  "reviewText": "The haircut was good."
}
```

## 8. Explicit image

POST `/api/ai/moderate-review-image`

```json
{
  "imageBase64": "data:image/jpeg;base64,REPLACE_WITH_TEST_IMAGE_BASE64",
  "merchantCategory": "Beauty salon",
  "serviceName": "Facial",
  "reviewText": "Review with inappropriate image."
}
```

## 9. Promotion recommendations

POST `/api/ai/promotions`

```json
{
  "merchantName": "Vaniday Beauty Studio",
  "merchantCategory": "Hair salon",
  "monthlySales": 3200,
  "monthlyBookings": 72,
  "averageRating": 4.6,
  "repeatCustomerRate": 28,
  "bestSellingService": "Hair Cut",
  "lowestPerformingService": "Ladies Haircut",
  "bestSellingProduct": "Pomade",
  "lowestPerformingProduct": "Hair Care Bundle Set",
  "lowBookingDays": ["Monday", "Tuesday"],
  "currentPromotions": ["First Trial Facial Glow"],
  "availableServices": ["Hair Cut", "Ladies Haircut"],
  "availableProducts": ["Pomade", "Hair Care Bundle Set"]
}
```

## 10. Voucher recommendations

POST `/api/ai/vouchers`

```json
{
  "customerBookingFrequency": 2,
  "customerTotalSpend": 180,
  "lastBookingDate": "2026-06-02",
  "favouriteMerchant": "Vaniday Beauty Studio",
  "favouriteService": "Hair Cut",
  "birthdayMonth": "July",
  "availableRewardPoints": 250,
  "merchantSales": 3200,
  "lowBookingDays": ["Monday", "Tuesday"],
  "existingVouchers": ["Birthday Month Voucher"],
  "voucherRedemptionPerformance": ["Birthday Month Voucher: 14 redemptions"]
}
```

## 11. Featured merchant recommendations

POST `/api/ai/featured-merchants`

```json
{
  "merchantStatistics": [
    {
      "merchantId": 1,
      "merchantName": "Vaniday Beauty Studio",
      "category": "Hair salon",
      "monthlySales": 3200,
      "bookingCount": 72,
      "averageRating": 4.6,
      "reviewCount": 22,
      "repeatCustomerRate": 28,
      "cancellationRate": 3,
      "refundRate": 1,
      "promotionPerformance": "First trial campaign produced 10 redemptions.",
      "accountStatus": "active"
    }
  ]
}
```

## 12. Featured service recommendations

POST `/api/ai/featured-services`

```json
{
  "serviceStatistics": [
    {
      "serviceId": 18,
      "serviceName": "Hair Cut",
      "merchantId": 1,
      "merchantName": "Vaniday Beauty Studio",
      "sales": 900,
      "bookingCount": 24,
      "rating": 4.8,
      "reviewCount": 12,
      "repeatBookingRate": 35,
      "cancellationRate": 2,
      "profitMargin": 45,
      "currentPromotionStatus": "not promoted"
    }
  ]
}
```

## 13. Featured product recommendations

POST `/api/ai/featured-products`

```json
{
  "productStatistics": [
    {
      "productId": 9,
      "productName": "Pomade",
      "merchantId": 1,
      "merchantName": "Vaniday Beauty Studio",
      "unitsSold": 18,
      "revenue": 684,
      "rating": 4.7,
      "reviewCount": 8,
      "repeatPurchaseRate": 20,
      "inventoryLevel": 25,
      "stockStatus": "in_stock",
      "currentPromotionStatus": "not promoted"
    }
  ]
}
```

## 14. Invalid API key

Set `GROQ_API_KEY` to an invalid value, restart the server, then call any endpoint. Expected: `503` with `GROQ_INVALID_API_KEY`.

## 15. Groq rate-limit error

Call an endpoint repeatedly or use a Groq account with exhausted quota. Expected: `429` with `GROQ_QUOTA_OR_RATE_LIMIT`.

## 16. Invalid JSON returned by the model

Temporarily point `GROQ_TEXT_MODEL` to a model/configuration that does not support JSON mode or mock the service to return non-JSON. Expected: `503` with `GROQ_INVALID_JSON`.
