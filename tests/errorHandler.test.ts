import request from "supertest";
import { app } from "../src/app";

describe("normalized request errors", () => {
  it("returns a 400 field-level error and request ID for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/v1/orders")
      .set("content-type", "application/json")
      .set("x-request-id", "malformed-json-test")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR", details: [{ field: "body" }] },
      request_id: "malformed-json-test"
    });
    expect(response.headers["x-request-id"]).toBe("malformed-json-test");
  });

  it("uses a generated request ID when the supplied ID is invalid", async () => {
    const response = await request(app)
      .post("/api/v1/orders")
      .set("content-type", "application/json")
      .set("x-request-id", "invalid request id")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body.request_id).not.toBe("invalid request id");
    expect(response.body.request_id).toBe(response.headers["x-request-id"]);
  });
});