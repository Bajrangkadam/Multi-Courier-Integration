import { pool } from "../db/pool";
import { NormalizedOrder, ShipmentStatus } from "../types/courier";

export class OrderRepository {
  async createPending(order: NormalizedOrder, requestId?: string) {
    const result = await pool.query(
      `INSERT INTO orders(order_id,courier_partner,status,request_payload,request_id)
       VALUES($1,$2,'PENDING',$3,$4)
       ON CONFLICT(order_id) DO NOTHING
       RETURNING *`,
      [order.order_id, order.courier_partner, order, requestId ?? null]
    );
    if (result.rows[0]) return { row: result.rows[0], duplicate: false };
    const existing = await pool.query("SELECT * FROM orders WHERE order_id=$1", [order.order_id]);
    return { row: existing.rows[0], duplicate: true };
  }

  async createBulkBatch(orders: NormalizedOrder[], requestId: string) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const batchResult = await client.query("INSERT INTO bulk_batches(total_count) VALUES($1) RETURNING id", [orders.length]);
      const batchId = batchResult.rows[0].id as string;
      const accepted: Array<{ order_id: string; duplicate: boolean }> = [];

      for (const order of orders) {
        const inserted = await client.query(
          `INSERT INTO orders(order_id,courier_partner,status,request_payload,request_id,batch_id)
           VALUES($1,$2,'PENDING',$3,$4,$5)
           ON CONFLICT(order_id) DO NOTHING RETURNING *`,
          [order.order_id, order.courier_partner, order, requestId, batchId]
        );
        const isDuplicate = !inserted.rows[0];
        const row = inserted.rows[0] ?? (await client.query("SELECT * FROM orders WHERE order_id=$1", [order.order_id])).rows[0];
        await client.query("INSERT INTO bulk_batch_items(batch_id,order_pk,duplicate) VALUES($1,$2,$3)", [batchId, row.id, isDuplicate]);
        if (!isDuplicate) await client.query("INSERT INTO order_outbox(order_pk,request_id) VALUES($1,$2)", [row.id, requestId]);
        accepted.push({ order_id: order.order_id, duplicate: isDuplicate });
      }
      await client.query("COMMIT");
      return { batch_id: batchId, total_count: orders.length, accepted };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getByOrderId(orderId: string) {
    const result = await pool.query("SELECT * FROM orders WHERE order_id=$1", [orderId]);
    return result.rows[0] ?? null;
  }

  async markCreated(id: string, courierResponse: any, status: ShipmentStatus) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
      `UPDATE orders SET courier_order_id=$2, awb_number=$3, status=$4,
       courier_request_payload=$5, courier_response_payload=$6, last_error_code=NULL,
       last_error_message=NULL, updated_at=NOW() WHERE id=$1`,
        [id, String(courierResponse.courier_order_id), String(courierResponse.awb_number), status, courierResponse.request, courierResponse.raw]
      );
      await client.query("INSERT INTO tracking_history(order_pk,status,raw_payload,source) VALUES($1,$2,$3,'courier-api')", [id, status, courierResponse.raw]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailure(id: string, code: string, message: string, context?: { courierRequest?: unknown; courierResponse?: unknown }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE orders SET status='FAILED',last_error_code=$2,last_error_message=$3,
         courier_request_payload=COALESCE($4,courier_request_payload),
         courier_response_payload=COALESCE($5,courier_response_payload),updated_at=NOW() WHERE id=$1`,
        [id, code, message, context?.courierRequest ?? null, context?.courierResponse ?? null]
      );
      await client.query("INSERT INTO tracking_history(order_pk,status,raw_payload,source) VALUES($1,'FAILED',$2,'system')", [id, { code, message }]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateStatus(id: string, status: ShipmentStatus, raw: unknown) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE orders SET status=$2,last_error_code=NULL,last_error_message=NULL,updated_at=NOW() WHERE id=$1", [id, status]);
      await client.query("INSERT INTO tracking_history(order_pk,status,raw_payload,source) VALUES($1,$2,$3,'courier-api')", [id, status, raw]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordOperationFailure(id: string, status: ShipmentStatus, operation: string, code: string, message: string, raw?: unknown) {
    const event = { operation, code, message, ...(raw === undefined ? {} : { courier_response: raw }) };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE orders SET last_error_code=$2,last_error_message=$3,updated_at=NOW() WHERE id=$1", [id, code, message]);
      await client.query("INSERT INTO tracking_history(order_pk,status,raw_payload,source) VALUES($1,$2,$3,'system')", [id, status, event]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendTracking(orderPk: string, status: ShipmentStatus, raw: unknown, source = "courier-api") {
    await pool.query("INSERT INTO tracking_history(order_pk,status,raw_payload,source) VALUES($1,$2,$3,$4)", [orderPk, status, raw, source]);
  }

  async tracking(orderPk: string) {
    const result = await pool.query("SELECT status,event_at,raw_payload,source FROM tracking_history WHERE order_pk=$1 ORDER BY event_at ASC,id ASC", [orderPk]);
    return result.rows;
  }

  async batch(batchId: string) {
    const batch = await pool.query("SELECT * FROM bulk_batches WHERE id=$1", [batchId]);
    if (!batch.rows[0]) return null;
    const orders = await pool.query(
      `SELECT o.order_id,o.courier_partner,o.status,o.awb_number,o.last_error_code,
       o.last_error_message,bi.duplicate FROM bulk_batch_items bi
       JOIN orders o ON o.id=bi.order_pk WHERE bi.batch_id=$1 ORDER BY bi.created_at`,
      [batchId]
    );
    const done = orders.rows.filter(order => order.status !== "PENDING").length;
    let status: string;
    if (done === orders.rows.length) status = "COMPLETED";
    else if (done === 0) status = "QUEUED";
    else status = "PROCESSING";
    await pool.query("UPDATE bulk_batches SET status=$2,updated_at=NOW() WHERE id=$1", [batchId, status]);
    return { ...batch.rows[0], status, processed_count: done, results: orders.rows };
  }

  async pendingOutbox(limit = 100) {
    return (await pool.query(
      "SELECT order_pk,request_id FROM order_outbox WHERE dispatched_at IS NULL ORDER BY created_at LIMIT $1",
      [limit]
    )).rows as Array<{ order_pk: string; request_id: string }>;
  }

  async markOutboxDispatched(orderPk: string) {
    await pool.query("UPDATE order_outbox SET dispatched_at=NOW() WHERE order_pk=$1 AND dispatched_at IS NULL", [orderPk]);
  }

  async setBatchStatus(batchId: string, status: string) {
    await pool.query("UPDATE bulk_batches SET status=$2,updated_at=NOW() WHERE id=$1", [batchId, status]);
  }
}
export const orderRepository = new OrderRepository();
