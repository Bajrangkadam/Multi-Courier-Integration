import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { app } from "../src/app";

describe("API documentation routes", () => {
  it("serves the OpenAPI document as JSON", async () => {
    const response = await request(app).get("/openapi.json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe("3.1.0");
    expect(response.body.paths["/api/v1/orders/bulk"]).toBeDefined();
  });

  it("serves Swagger UI", async () => {
    const response = await request(app).get("/api-docs/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("swagger-ui");
  });

  it("keeps the OpenAPI spec and Postman collection aligned with registered routes", async () => {
    const openApi = (await request(app).get("/openapi.json")).body;
    const collectionPath = path.resolve(__dirname, "../postman/Multi-Courier-Integration.postman_collection.json");
    const collection = JSON.parse(readFileSync(collectionPath, "utf8"));
    const paths = openApi.paths;

    expect(paths["/health"].get).toBeDefined();
    expect(paths["/api/v1/couriers"].get).toBeDefined();
    expect(paths["/api/v1/orders"].post).toBeDefined();
    expect(paths["/api/v1/orders/bulk"].post).toBeDefined();
    expect(paths["/api/v1/orders/{orderId}"].get).toBeDefined();
    expect(paths["/api/v1/orders/{orderId}/track"].get).toBeDefined();
    expect(paths["/api/v1/orders/{orderId}/cancel"].post).toBeDefined();
    expect(paths["/api/v1/batches/{batchId}"].get).toBeDefined();
    expect(collection.info.schema).toContain("collection/v2.1.0");
    expect(collection.item.map((folder: { name: string }) => folder.name)).toContain("03 - Bulk Create and Poll");
  });
});