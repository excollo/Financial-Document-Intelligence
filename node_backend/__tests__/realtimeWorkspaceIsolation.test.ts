describe("realtime workspace isolation", () => {
  it("emits workspace-scoped events only to target workspace room", async () => {
    jest.resetModules();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    jest.doMock("../index", () => ({
      io: { to, emit: jest.fn() },
    }));
    const { emitToWorkspace } = await import("../services/realtimeEmitter");

    await emitToWorkspace("ws-B", "upload_status", { jobId: "job-1", workspaceId: "ws-B" });

    expect(to).toHaveBeenCalledWith("workspace_ws-B");
    expect(to).not.toHaveBeenCalledWith("workspace_ws-A");
    expect(to).not.toHaveBeenCalledWith("tenant_t-1");
  });

  it("delivers events to authorized workspace room", async () => {
    jest.resetModules();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    jest.doMock("../index", () => ({
      io: { to, emit: jest.fn() },
    }));
    const { emitToWorkspace } = await import("../services/realtimeEmitter");

    await emitToWorkspace("ws-auth", "summary_status", { jobId: "job-2", workspaceId: "ws-auth" });

    expect(to).toHaveBeenCalledWith("workspace_ws-auth");
    expect(emit).toHaveBeenCalledWith(
      "summary_status",
      expect.objectContaining({ jobId: "job-2", workspaceId: "ws-auth" })
    );
  });
});
