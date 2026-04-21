describe("realtime compat mode", () => {
  it("does not enable global compat emit in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.REALTIME_GLOBAL_BROADCAST_COMPAT = "true";
    jest.resetModules();
    const ioEmit = jest.fn();
    jest.doMock("../index", () => ({
      io: {
        to: () => ({ emit: jest.fn() }),
        emit: ioEmit,
      },
    }));
    const { emitToWorkspace } = await import("../services/realtimeEmitter");
    emitToWorkspace("ws-1", "upload_status", { jobId: "j1" });
    expect(ioEmit).not.toHaveBeenCalled();
  });
});

