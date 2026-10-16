# Multi-Courier Integration Platform (Node.js)

A courier-agnostic REST API built with Node.js, TypeScript, Express, PostgreSQL, Redis, and BullMQ. UrbaneBolt is the first real-provider adapter boundary; MockCourier is included to demonstrate plug-in extensibility without credentials.

## What is included

- Unified endpoints for create, track, cancel, order lookup, supported couriers, and bulk creation.
- Adapter + Strategy + Registry pattern; controllers and business logic do not depend on provider-specific payloads.
- PostgreSQL order persistence with raw request/response payloads and append-only tracking history.
- Idempotency via unique `orders.order_id`.
- Bulk requests accept 1–100 orders and return `202 Accepted` with a `batch_id`; jobs run in the background with configurable concurrency and exponential retry.
- Normalized error response shape and request IDs.
- Zod field-level validation, structured logging, health endpoint, Docker Compose, tests, and curl examples.

## Project structure

```text
.
├── docs/
│   └── openapi.json
├── migrations/
│   └── 001_init.sql
├── postman/
│   └── Multi-Courier-Integration.postman_collection.json
├── src/
│   ├── controllers/
│   ├── couriers/
│   │   ├── mock/
│   │   └── urbanebolt/
│   ├── db/
│   ├── errors/
│   ├── queues/
│   ├── services/
│   ├── types/
│   ├── validation/
│   ├── app.ts
│   ├── config.ts
│   ├── routes.ts
│   ├── server.ts
│   └── worker.ts
├── tests/
├── .env.example
├── docker-compose.yml
├── package.json
├── package-lock.json
├── DESIGN.md
├── README.md
└── vitest.config.mts
```

## UrbaneBolt UAT contract

The adapter uses the documented auth, Manifest, Tracking, and Cancellation endpoints. Manifest requires a customer code and package dimensions/weights, supplied by `URBANEBOLT_CUSTOMER_CODE` and normalized order fields. The collection does not provide response examples for these operations, so response identifier/status mappings still need confirmation with valid UAT credentials. Do not commit real credentials. Creation sends the internal order ID as `orderNumber` and an `Idempotency-Key`; confirm the provider honors either for deduplication before relying on retries after ambiguous timeouts.

## Requirements

- Node.js 20+ (native `fetch`)
- Docker + Docker Compose
- npm

## Run locally

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run dev
```

In a second terminal, run the background worker:

```bash
npm run worker
```

API health: `GET http://localhost:3000/health`
Interactive API reference: `http://localhost:3000/api-docs/`
OpenAPI document: `http://localhost:3000/openapi.json`

The database migration is mounted into PostgreSQL's initialization directory for a fresh volume. `npm run db:migrate` is safe to run again. If you changed the SQL after a volume already exists, the entrypoint will not re-run initialization SQL; use the explicit migration command.

## Tests and build

```bash
npm test
npm run build
```

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `CORS_ORIGINS` | Comma-separated browser origins allowed to call the API |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `QUEUE_NAME` | BullMQ queue name |
| `BULK_CONCURRENCY` | Number of jobs processed in parallel |
| `COURIER_TIMEOUT_MS` | Provider HTTP timeout |
| `COURIER_MAX_RETRIES` | Maximum attempts for transient provider failures |
| `COURIER_RETRY_BASE_DELAY_MS` | Exponential retry base delay |
| `URBANEBOLT_BASE_URL` | UrbaneBolt UAT base URL |
| `URBANEBOLT_USERNAME` / `URBANEBOLT_PASSWORD` | Provider UAT credentials |
| `URBANEBOLT_COOKIE` | Optional provider-issued cookie if required by the UAT account |
| `URBANEBOLT_CUSTOMER_CODE` | UrbaneBolt account/customer code for Manifest requests |
| `URBANEBOLT_SERVICE_TYPE` | Service code sent to Manifest (default `SDD`) |
| `URBANEBOLT_AUTH_PATH` | Defaults to documented `/api/v1/auth/getToken/` |
| `URBANEBOLT_CREATE_ORDER_PATH` | Defaults to documented `/api/v1/services/manifest/` |
| `URBANEBOLT_TRACK_PATH` | Defaults to `/api/v1/services/tracking-pub/?awb={awb}` |
| `URBANEBOLT_CANCEL_PATH` | Defaults to documented `/api/v1/services/cancel/` |

## API contract

All successful responses use `{ "success": true, "data": ..., "request_id": "..." }`. Errors use `{ "success": false, "error": { "code": "...", "message": "...", "details": ... }, "request_id": "..." }`. Raw upstream error bodies are not returned to API consumers.

## Postman and Swagger

Import [`postman/Multi-Courier-Integration.postman_collection.json`](postman/Multi-Courier-Integration.postman_collection.json) into Postman. The collection variable `baseUrl` defaults to `http://localhost:3000`; change it for another API environment. No courier secrets or tokens are stored in the collection.

Run the requests in this order for a complete local flow:

1. In **01 - Health and Discovery**, run **Health** and **List Supported Couriers**.
2. In **02 - MockCourier Single Order Lifecycle**, run **Create MockCourier Order**, **Get Order**, **Track Order**, and **Cancel Order** in order. The create request generates a new order ID and stores it for later requests.
3. Start `npm run worker` in another terminal. In **03 - Bulk Create and Poll**, run **Submit Bulk Orders**, then repeat **Get Batch** until its status is `COMPLETED`.
4. The requests in **04 - Normalized Error Examples** intentionally return HTTP 400 and demonstrate the standard error response.
5. Run **05 - UrbaneBolt UAT (Optional)** only after setting server-side UAT credentials and customer code in `.env`. This order needs item `weight_kg` and `package_dimensions`.

Swagger UI is served by the API at `/api-docs/`; the source specification is [`docs/openapi.json`](docs/openapi.json). It includes all public endpoints, schemas, and common response codes.

### Create one order

```bash
curl -X POST http://localhost:3000/api/v1/orders \
  -H 'content-type: application/json' \
  -d '{
    "order_id":"ORD-1001",
    "courier_partner":"mockcourier",
    "pickup":{"name":"Warehouse","phone":"9999999999","line1":"Warehouse Road","city":"Pune","state":"Maharashtra","postal_code":"411001","country":"India"},
    "delivery":{"name":"Customer","phone":"8888888888","line1":"MG Road","city":"Mumbai","state":"Maharashtra","postal_code":"400001","country":"India"},
    "items":[{"sku":"SKU-1","name":"Demo item","quantity":1,"unit_price":499}],
    "payment_mode":"PREPAID",
    "declared_value":499,
    "currency":"INR"
  }'
```

Use `courier_partner: "urbanebolt"` to route to UrbaneBolt after setting valid UAT config and verifying its contract.
UrbaneBolt orders also require `package_dimensions` (`height_cm`, `length_cm`, `width_cm`) and `weight_kg` on each item. `email` is optional on each address.

### Track an order

```bash
curl http://localhost:3000/api/v1/orders/ORD-1001/track
```

### Cancel an order

```bash
curl -X POST http://localhost:3000/api/v1/orders/ORD-1001/cancel
```

### Get order and supported couriers

```bash
curl http://localhost:3000/api/v1/orders/ORD-1001
curl http://localhost:3000/api/v1/couriers
```

### Bulk create (up to 100)

```bash
curl -X POST http://localhost:3000/api/v1/orders/bulk \
  -H 'content-type: application/json' \
  -d '{"orders":[
    {"order_id":"ORD-BULK-1","courier_partner":"mockcourier","pickup":{"name":"Warehouse","phone":"9999999999","line1":"Warehouse Road","city":"Pune","state":"Maharashtra","postal_code":"411001","country":"India"},"delivery":{"name":"Customer 1","phone":"8888888888","line1":"MG Road","city":"Mumbai","state":"Maharashtra","postal_code":"400001","country":"India"},"items":[{"sku":"SKU-1","name":"Demo item","quantity":1,"unit_price":100}],"payment_mode":"PREPAID","declared_value":100,"currency":"INR"}
  ]}'
```

Order rows, batch membership, and outbox entries are saved in one PostgreSQL transaction. The worker dispatcher retries publishing outbox entries while Redis is unavailable. Batch polling reports every submitted order, including duplicates:

```bash
curl http://localhost:3000/api/v1/batches/<batch_id>
```

### Error examples

- Validation: `400 VALIDATION_ERROR`, with field-level details.
- Unsupported courier: `400 UNSUPPORTED_COURIER`, including supported courier names.
- Missing order: `404 ORDER_NOT_FOUND`.
- Provider failure: normalized `502`/`504` code; raw provider response is not exposed.
- Duplicate `order_id`: returns the existing order instead of creating a second shipment; the new batch still includes it with `duplicate: true`.

## Adding another courier

1. Implement `CourierAdapter` in `src/types/courier.ts`.
2. Map normalized order input to provider request only inside the new adapter.
3. Normalize provider response/status into `ShipmentStatus`.
4. Register the adapter in `src/couriers/index.ts`.
5. Add adapter tests and environment variables.
6. No controller, route, DTO, or order-service changes should be necessary.

## Design decisions and trade-offs

- **Synchronous single order:** simple consumer contract; the provider call is made during the request. For strict production resilience, move single-order creation to the same queue pattern.
- **Asynchronous bulk:** return immediately with a batch ID; consumer polls batch status. Avoids holding an HTTP request open for 100 external calls.
- **Idempotency:** a unique database constraint prevents duplicate internal orders. For full external exactly-once behavior, send a stable idempotency/reference key to each courier if supported and reconcile ambiguous network timeouts before retrying. A local DB constraint alone cannot guarantee the remote courier didn't create a shipment before a timeout.
- **Retry:** transient provider failures (5xx, timeout, network) are retried with configured exponential backoff; permanent rejections are not. Bulk retries use BullMQ; single create, track, and cancel use the same attempt count. Confirm provider-side idempotency before relying on retries after ambiguous timeouts.
- **Outbox:** the worker periodically publishes pending outbox rows to BullMQ, preventing accepted orders from being stranded when Redis is unavailable during the API call.
- **Tracking:** history rows are inserted for each status event. This code polls on the track endpoint; production webhooks/polling schedulers should append events and deduplicate provider event IDs if available.
- **Security:** configure TLS, secret manager, API authentication/authorization, rate limiting, and PII retention policy before production.
