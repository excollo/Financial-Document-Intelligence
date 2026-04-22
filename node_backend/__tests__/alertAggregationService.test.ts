import { alertAggregationService } from "../services/alertAggregationService";

jest.mock("../services/cacheService", () => ({
  getRedisClient: jest.fn(),
}));

describe("alert aggregation service", () => {
  it("increments repeated alerts and flags burst", async () => {
    const mem: Record<string, number> = {};
    const expiries: Record<string, number> = {};
    const fakeRedis = {
      incr: jest.fn(async (key: string) => {
        mem[key] = (mem[key] || 0) + 1;
        return mem[key];
      }),
      expire: jest.fn(async (key: string, seconds: number) => {
        expiries[key] = seconds;
      }),
    };
    const { getRedisClient } = jest.requireMock("../services/cacheService");
    getRedisClient.mockReturnValue(fakeRedis);

    const first = await alertAggregationService.recordAlert({
      alertType: "threshold_exceeded",
      metric: "queue_depth",
      severity: "warning",
      service: "node",
    });
    expect(first.count).toBe(1);
    expect(first.burst).toBe(false);

    let result: any = null;
    for (let i = 0; i < 10; i += 1) {
      result = await alertAggregationService.recordAlert({
        alertType: "threshold_exceeded",
        metric: "queue_depth",
        severity: "warning",
        service: "node",
      });
    }
    expect(result.count).toBeGreaterThan(1);
    expect(result.burst).toBe(true);
    expect(expiries[Object.keys(expiries)[0]]).toBeGreaterThan(0);
  });
});
