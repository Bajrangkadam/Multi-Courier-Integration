import { AppError } from "../src/errors/AppError";
import { requestJson } from "../src/couriers/http";
import { vi } from "vitest";

function response(body: unknown, status: number): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

describe("courier HTTP error mapping", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => { fetchMock = vi.spyOn(global, "fetch"); });
  afterEach(() => fetchMock.mockRestore());

  it("marks upstream 5xx responses retryable and normalizes their messages", async () => {
    fetchMock.mockResolvedValueOnce(response({ message: "private provider detail" }, 503));
    await expect(requestJson("https://courier.example/test")).rejects.toMatchObject({
      statusCode: 502,
      code: "COURIER_UPSTREAM_FAILURE",
      retryable: true,
      message: "Courier provider is temporarily unavailable"
    } satisfies Partial<AppError>);
  });

  it("does not retry provider 4xx rejections or expose the raw body", async () => {
    fetchMock.mockResolvedValueOnce(response({ message: "private provider detail" }, 422));
    await expect(requestJson("https://courier.example/test")).rejects.toMatchObject({
      statusCode: 422,
      code: "COURIER_REQUEST_REJECTED",
      retryable: false,
      message: "Courier provider rejected the request",
      details: undefined
    } satisfies Partial<AppError>);
  });

  it("marks network failures retryable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket reset"));
    await expect(requestJson("https://courier.example/test")).rejects.toMatchObject({
      statusCode: 502,
      code: "COURIER_NETWORK_ERROR",
      retryable: true
    } satisfies Partial<AppError>);
  });
});