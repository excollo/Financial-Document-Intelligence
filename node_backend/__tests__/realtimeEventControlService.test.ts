import { realtimeEventControlService } from "../services/realtimeEventControlService";

jest.mock("../services/cacheService", () => ({
  getRedisClient: jest.fn(),
}));

describe("realtime terminal event guarantees", () => {
  it("always emits terminal events even under dedupe/burst", async () => {
    const { getRedisClient } = jest.requireMock("../services/cacheService");
    getRedisClient.mockReturnValue({
      set: jest.fn().mockResolvedValue(null),
      incr: jest.fn().mockResolvedValue(999),
      expire: jest.fn().mockResolvedValue(1),
    });

    await expect(
      realtimeEventControlService.shouldEmit("compare_status", "tenant_t1", {
        jobId: "job-1",
        status: "completed",
      })
    ).resolves.toBe(true);
    await expect(
      realtimeEventControlService.shouldEmit("compare_status", "tenant_t1", {
        jobId: "job-1",
        status: "failed",
      })
    ).resolves.toBe(true);
    await expect(
      realtimeEventControlService.shouldEmit("compare_status", "tenant_t1", {
        jobId: "job-1",
        status: "completed_with_errors",
      })
    ).resolves.toBe(true);
  });
});
