# Design: Multi-Courier Integration Platform

## Architecture and pattern

The API is divided into transport (Express routes/controllers), validation (Zod), business orchestration (`OrderService`), persistence (`OrderRepository`), async work (BullMQ worker), and provider adapters (`CourierAdapter`). The Adapter pattern translates a normalized internal contract to each provider's contract. A Strategy/Registry selects an adapter by `courier_partner`. This keeps provider-specific details out of routes and business services and meets the extensibility requirement.

## Data model

- `orders`: unique internal `order_id`, courier partner, courier order ID, AWB, normalized status, normalized inbound payload, exact provider request/response payloads, error details, batch ID, timestamps.
- `tracking_history`: append-only status events, event timestamp, raw provider payload, source, and foreign key to `orders`.
- `bulk_batches`: batch status, count, and timestamps.
- `bulk_batch_items`: per-batch order membership and duplicate marker.
- `order_outbox`: transactional record of accepted work awaiting queue publication.

The unique `orders.order_id` constraint is the final concurrency-safe idempotency guard. Tracking history has no update/delete operation in application code.

## Bulk design

`POST /orders/bulk` validates a maximum of 100 orders and rejects repeated IDs within one request. One PostgreSQL transaction inserts batch membership and new orders plus outbox entries for new work, then returns HTTP 202 with a `batch_id`. A worker-side dispatcher retries publishing outbox rows to BullMQ. Workers process at configurable concurrency and retry transient courier failures with exponential backoff. Consumers poll `GET /batches/:batchId`; results include duplicate, success, pending, and failure states per input order.

## Error model

All errors use `success:false`, a normalized `error.code` and `error.message`, optional field details, and `request_id`. Raw provider errors are logged internally but not sent to consumers. Validation returns 400; unknown courier returns 400 with supported names; missing resources return 404; provider failures map to gateway/timeout errors.

## API documentation

The OpenAPI 3.1 document is maintained at `docs/openapi.json` and served as interactive Swagger UI at `/api-docs/`; the raw document is available at `/openapi.json`. The Postman v2.1 collection at `postman/Multi-Courier-Integration.postman_collection.json` covers the local MockCourier lifecycle, asynchronous bulk polling, normalized error examples, and optional configured UrbaneBolt UAT requests.

## Provider integration assumptions

The UAT collection documents the username/password token route, Manifest endpoint `/api/v1/services/manifest/`, Tracking endpoint `/api/v1/services/tracking-pub/?awb=...`, and Cancellation endpoint `/api/v1/services/cancel/` with an `awbs` request property. Manifest request mapping follows its documented field names and requires a customer code, dimensions, and item weights. The collection lacks response examples, so returned AWB/status field mappings require confirmation against a live UAT response. Creation sends a stable order number and idempotency header; provider-side deduplication must be confirmed before relying on it for timeout retries. Credentials and URLs are environment-based.

## Trade-offs and next steps

1. Single-order create currently calls the courier synchronously; move it to queue if API latency or provider availability warrants it.
2. A local idempotency constraint cannot alone guarantee exactly-once remote shipment creation after an ambiguous timeout. Provider-supported idempotency and reconciliation remain required for exactly-once external behavior.
3. Production hardening should add authn/authz, rate limits, webhook signature verification, dead-letter handling, metrics/tracing, and provider-specific retry classification.
4. Tracking endpoint performs a live provider poll and appends the returned status. For high scale, schedule polling or consume signed provider webhooks and deduplicate events.
