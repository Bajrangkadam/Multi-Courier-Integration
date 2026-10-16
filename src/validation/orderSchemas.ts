import { z } from "zod";

const address = z.object({
  name: z.string().min(1).max(150),
  phone: z.string().min(5).max(30),
  email: z.string().email().optional(),
  line1: z.string().min(1).max(250),
  line2: z.string().max(250).optional(),
  city: z.string().min(1).max(100),
  state: z.string().min(1).max(100),
  postal_code: z.string().min(3).max(20),
  country: z.string().min(2).max(80)
});
export const orderSchema = z.object({
  order_id: z.string().min(1).max(120),
  courier_partner: z.string().min(1).max(50).transform(v => v.toLowerCase()),
  pickup: address,
  delivery: address,
  items: z.array(z.object({
    sku: z.string().min(1), name: z.string().min(1),
    quantity: z.number().int().positive(), unit_price: z.number().nonnegative(),
    weight_kg: z.number().positive().optional()
  })).min(1).max(100),
  payment_mode: z.enum(["PREPAID", "COD"]),
  cod_amount: z.number().nonnegative().optional(),
  declared_value: z.number().nonnegative(),
  currency: z.string().length(3).default("INR"),
  package_dimensions: z.object({ height_cm: z.number().positive(), length_cm: z.number().positive(), width_cm: z.number().positive() }).optional(),
  metadata: z.record(z.unknown()).optional()
}).superRefine((v, ctx) => {
  if (v.payment_mode === "COD" && (v.cod_amount === undefined || v.cod_amount <= 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["cod_amount"], message: "cod_amount must be greater than zero for COD orders" });
  }
  if (v.courier_partner === "urbanebolt") {
    if (!v.package_dimensions) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["package_dimensions"], message: "package_dimensions are required for UrbaneBolt orders" });
    }
    v.items.forEach((item, index) => {
      if (item.weight_kg === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "weight_kg"], message: "weight_kg is required for UrbaneBolt orders" });
      }
    });
  }
});
export const bulkSchema = z.object({ orders: z.array(orderSchema).min(1).max(100) }).superRefine(({ orders }, ctx) => {
  const seen = new Set<string>();
  orders.forEach((order, index) => {
    if (seen.has(order.order_id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["orders", index, "order_id"], message: "order_id must be unique within a batch" });
    seen.add(order.order_id);
  });
});
