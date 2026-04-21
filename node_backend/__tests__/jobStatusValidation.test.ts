import { updateJobStatus } from "../controllers/jobController";

jest.mock("../models/Job", () => ({
  Job: {
    findOneAndUpdate: jest.fn(),
  },
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("internal job status validation", () => {
  it("rejects invalid status values", async () => {
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        status: "totally_invalid",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

