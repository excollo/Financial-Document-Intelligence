import { resolveAuthorizedWorkspaceIds } from "../services/socketRoomResolver";

jest.mock("../models/WorkspaceMembership", () => ({
  WorkspaceMembership: {
    find: jest.fn(),
  },
}));

describe("socket room resolver", () => {
  it("returns only active membership workspaces", async () => {
    const { WorkspaceMembership } = require("../models/WorkspaceMembership");
    WorkspaceMembership.find.mockReturnValue({
      select: () => ({
        lean: async () => [{ workspaceId: "ws-a" }, { workspaceId: "ws-b" }],
      }),
    });

    const ids = await resolveAuthorizedWorkspaceIds("user-1", "ws-current");
    expect(ids.sort()).toEqual(["ws-a", "ws-b"].sort());
    expect(ids).not.toContain("forged-workspace");
  });

  it("does not include unauthorized currentWorkspace", async () => {
    const { WorkspaceMembership } = require("../models/WorkspaceMembership");
    WorkspaceMembership.find.mockReturnValue({
      select: () => ({
        lean: async () => [{ workspaceId: "ws-1" }],
      }),
    });

    const ids = await resolveAuthorizedWorkspaceIds("user-2", "ws-forged");
    expect(ids).toEqual(["ws-1"]);
    expect(ids).not.toContain("ws-forged");
  });
});

