CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id VARCHAR(120) NOT NULL UNIQUE,
  courier_partner VARCHAR(50) NOT NULL,
  courier_order_id VARCHAR(200),
  awb_number VARCHAR(200),
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  request_payload JSONB NOT NULL,
  courier_request_payload JSONB,
  courier_response_payload JSONB,
  last_error_code VARCHAR(80),
  last_error_message TEXT,
  request_id VARCHAR(100),
  batch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_partner_status ON orders(courier_partner, status);
CREATE INDEX IF NOT EXISTS idx_orders_batch_id ON orders(batch_id);

CREATE TABLE IF NOT EXISTS tracking_history (
  id BIGSERIAL PRIMARY KEY,
  order_pk UUID NOT NULL REFERENCES orders(id),
  status VARCHAR(30) NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'courier-api',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tracking_order_event ON tracking_history(order_pk, event_at DESC);

CREATE TABLE IF NOT EXISTS bulk_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_count INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bulk_batch_items (
  batch_id UUID NOT NULL REFERENCES bulk_batches(id) ON DELETE CASCADE,
  order_pk UUID NOT NULL REFERENCES orders(id),
  duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(batch_id, order_pk)
);

CREATE TABLE IF NOT EXISTS order_outbox (
  order_pk UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  request_id VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_order_outbox_pending ON order_outbox(created_at) WHERE dispatched_at IS NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_id VARCHAR(100);

-- Append-only protection for tracking history: application code has no update/delete path.
