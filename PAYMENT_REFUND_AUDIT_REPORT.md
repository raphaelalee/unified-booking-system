# Payment and refund audit report

## Summary

The payment flow already had server-side verification for the implemented providers:

- Stripe return handler retrieves the Checkout Session and requires `payment_intent.status === 'succeeded'`.
- PayPal capture handler requires order status and capture status to be `COMPLETED`, and verifies the captured amount/currency.
- HitPay return/webhook checks the payment request status unless `HITPAY_TRUST_REDIRECT=true` is explicitly enabled.

The main issue was after successful payment: provider IDs were not copied into `transactions`, and Help Center refunds were database-only. Admin approval could mark an order/booking refunded without calling Stripe or PayPal.

## Bugs found

- Stripe successful payments saved as paid transactions but did not persist the Stripe `payment_intent` ID into `transactions`.
- PayPal successful payments saved as paid transactions but did not persist the PayPal capture ID into `transactions`.
- HitPay payments saved as paid transactions but did not persist the HitPay payment request ID into `transactions`.
- Help Center admin-approved refunds updated local database status only.
- PayPal service had no refund API helper.
- Refund records did not store provider refund ID, refund reason, refunded_by, or a provider response ledger.
- Booking refunds did not update the booking `refund_status` after final refund processing.
- Duplicate/over-limit refunds were not validated against a durable refund ledger.

## Fixes implemented

- Added provider payment metadata to `transactions`.
- Added `payment_refunds` ledger table.
- Added `models/PaymentRefund.js`.
- Added `services/refundProcessor.js`.
- Added PayPal capture refund API call.
- Updated Stripe success handling to store `payment_intent` and session ID.
- Updated PayPal capture handling to store capture ID and order ID.
- Updated HitPay completion handling to store payment request ID.
- Updated Help Center admin approval to call the refund processor before marking a refund request approved.
- Stripe refunds now call Stripe Refunds API.
- PayPal refunds now call PayPal capture refund API.
- HitPay, NETS, direct/manual, rewards, and cashback-only refunds are marked `manual_required` instead of pretending that money was returned automatically.
- Added server-side refund amount validation so refund total cannot exceed the paid transaction amount.
- Added duplicate/full-refund prevention using `payment_refunds`.

## Changed files

- `controllers/helpCenterController.js`
- `controllers/merchantController.js`
- `models/Booking.js`
- `models/Transaction.js`
- `models/PaymentRefund.js`
- `services/paypal.js`
- `services/refundProcessor.js`
- `database/20260609_payment_refund_schema_update.sql`

## Database changes

Added/ensured these `transactions` columns:

- `currency`
- `payment_provider`
- `provider_payment_id`
- `provider_session_id`
- `provider_capture_id`
- `provider_refund_id`
- `refund_reason`
- `refunded_by`

Added/ensured this index:

- `idx_transactions_provider_payment (payment_provider, provider_payment_id)`

Added table:

- `payment_refunds`

Important `payment_refunds` columns:

- `refund_id`
- `transaction_id`
- `booking_id`
- `order_id`
- `user_id`
- `merchant_id`
- `refunded_by`
- `refund_amount`
- `currency`
- `refund_status`
- `refund_reason`
- `payment_provider`
- `provider_payment_id`
- `provider_session_id`
- `provider_capture_id`
- `provider_refund_id`
- `provider_response_json`
- `created_at`
- `updated_at`

## Provider behavior

Stripe:

- Success is validated server-side through retrieved Checkout Session.
- `payment_intent.status` must be `succeeded`.
- Refunds call `stripe.refunds.create`.
- `provider_refund_id` stores the Stripe refund ID.

PayPal:

- Capture is validated server-side.
- Status and amount/currency must match the trusted payment.
- Refunds call `/v2/payments/captures/{capture_id}/refund`.
- `provider_refund_id` stores the PayPal refund ID.

HitPay:

- Success is checked through payment request status/webhook.
- Payment request ID is stored.
- Automatic refund API was not present in the existing integration, so refunds are marked `manual_required`.
- This avoids fake refunds.

Manual/direct/NETS/rewards/cashback:

- Marked `manual_required` where provider refund automation is unavailable.
- Admin must process externally and reconcile with the ledger.

## Verification performed

- Ran the updated migration successfully against `vaniday_booking_system`.
- Migration result: 152 SQL statements executed successfully.
- JavaScript syntax checks passed:
  - `app.js`
  - `controllers/helpCenterController.js`
  - `controllers/merchantController.js`
  - `models/Booking.js`
  - `models/Transaction.js`
  - `models/PaymentRefund.js`
  - `services/paypal.js`
  - `services/refundProcessor.js`
- Verified new `transactions` provider/refund columns exist.
- Verified `payment_refunds` table exists.
- Smoke-tested a manual/direct refund path:
  - created a temporary paid transaction
  - processed refund through `refundProcessor`
  - verified `payment_refunds` row
  - verified transaction `refund_status = manual_required`
  - verified `refunded_amount`, `refund_reason`, and `refunded_by`
  - cleaned up temporary rows

## Not live-tested

Live provider refunds were not executed against Stripe/PayPal sandbox because that would require real sandbox payments/captures created in the active provider accounts.

## Required environment variables

Existing:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_CURRENCY`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_MODE`
- `PAYPAL_API` optional override; defaults to `https://api-m.sandbox.paypal.com`
- `HITPAY_API_KEY`
- `HITPAY_URL` or `HITPAY_BASE_URL`
- `HITPAY_SALT` or `HITPAY_WEBHOOK_SALT`
- `HITPAY_TRUST_REDIRECT` optional; should normally remain unset or `false`
- `APP_URL`

Note: `services/hitpay.js` now accepts both `HITPAY_URL` and `HITPAY_BASE_URL`.

## SQL to run

In MySQL Workbench:

```sql
USE vaniday_booking_system;
SOURCE C:/Users/nickn/OneDrive - Republic Polytechnic/2425 S1/FYP/unified-booking-system/database/20260609_payment_refund_schema_update.sql;
```

In phpMyAdmin:

1. Select `vaniday_booking_system`.
2. Open Import.
3. Import `database/20260609_payment_refund_schema_update.sql`.

## Node commands

```powershell
npm install
node --check app.js
node --check controllers/helpCenterController.js
node --check controllers/merchantController.js
node --check models/Transaction.js
node --check models/PaymentRefund.js
node --check services/paypal.js
node --check services/refundProcessor.js
npm start
```

## Manual test steps

Stripe success:

1. Start the app.
2. Checkout with Stripe sandbox.
3. Complete payment.
4. Confirm receipt page opens.
5. In MySQL, confirm `transactions.payment_provider = 'stripe'`, `provider_payment_id` is set, and `provider_session_id` is set.

Stripe cancel/fail:

1. Start Stripe checkout.
2. Cancel before payment.
3. Confirm no paid transaction is created.

Stripe refund:

1. Submit a refund request from Help Center for the paid order/booking.
2. Admin sends to merchant.
3. Merchant approves.
4. Admin approves.
5. Expected: Stripe refund is created, `payment_refunds.provider_refund_id` is set, `transactions.refund_status` becomes `refunded` or `partially_refunded`.

PayPal success:

1. Checkout with PayPal sandbox.
2. Approve and capture.
3. Confirm `transactions.payment_provider = 'paypal'`, `provider_capture_id` is set, and amount/currency match.

PayPal refund:

1. Complete the Help Center refund approval flow.
2. Expected: PayPal capture refund is created and stored in `payment_refunds.provider_refund_id`.

HitPay success:

1. Checkout with HitPay sandbox.
2. Complete payment.
3. Confirm `transactions.payment_provider = 'hitpay'` and provider request ID is stored.

HitPay refund:

1. Complete the Help Center refund approval flow.
2. Expected: `transactions.refund_status = 'manual_required'` and a `payment_refunds` row is created.
3. Admin must refund manually in HitPay/provider portal.

Duplicate refund:

1. Attempt to approve another refund for the same fully refunded transaction.
2. Expected: server rejects because the remaining refundable amount is zero.

Over-refund:

1. Attempt to refund more than the paid amount.
2. Expected: server rejects with remaining refundable amount.

Merchant ownership:

1. Log in as a merchant.
2. Try to respond to a refund request not assigned to that merchant.
3. Expected: request update affects zero rows and is rejected.
