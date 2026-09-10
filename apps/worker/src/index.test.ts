import { describe, expect, it } from "vitest";
import worker, { drainQueue, type DrainBatch, type DrainMessage } from "./index.js";

describe("GET /healthz (orbb-worker)", () => {
  it("returns 200 with the ok payload via the Worker fetch handler (no network)", async () => {
    const response = await worker.fetch(new Request("https://synthetic.internal/healthz"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true, service: "orbb-worker" });
  });
});

describe("drainQueue (no-op queue-drain stub)", () => {
  it("acknowledges every message in the batch, in order", async () => {
    const acknowledged: string[] = [];
    const message = (id: string): DrainMessage => ({
      id,
      body: { synthetic: true },
      ack: () => {
        acknowledged.push(id);
      },
      retry: () => {
        throw new Error("retry must not be called by the drain stub");
      },
    });
    const batch: DrainBatch = {
      queue: "SYNTH-test-queue",
      messages: [message("SYNTH-msg-1"), message("SYNTH-msg-2"), message("SYNTH-msg-3")],
    };
    await drainQueue(batch);
    expect(acknowledged).toEqual(["SYNTH-msg-1", "SYNTH-msg-2", "SYNTH-msg-3"]);
  });

  it("handles an empty batch", async () => {
    await expect(drainQueue({ queue: "SYNTH-test-queue", messages: [] })).resolves.toBeUndefined();
  });
});
