import { resolveAuthorizedWorkspaceIds } from "../services/socketRoomResolver";

jest.mock("../models/WorkspaceMembership", () => ({
  WorkspaceMembership: {
    find: jest.fn(),
  },
}));

describe("socket room resolver", () => {
  it("returns only server-side authorized workspaces", async () => {
    const { WorkspaceMembership } = require("../models/WorkspaceMembership");
    WorkspaceMembership.find.mockReturnValue({
      select: () => ({
        lean: async () => [{ workspaceId: "ws-a" }, { workspaceId: "ws-b" }],
      }),
    });

    const ids = await resolveAuthorizedWorkspaceIds("user-1", "ws-current");
    expect(ids.sort()).toEqual(["ws-a", "ws-b", "ws-current"].sort());
    expect(ids).not.toContain("forged-workspace");
  });
});

