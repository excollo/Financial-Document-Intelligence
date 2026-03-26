// src/components/chatcomponents/__tests__/SummaryPanel.test.tsx
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SummaryPanel } from "../SummaryPanel";
import { summaryService, shareService } from "@/services/api";
import { summaryN8nService } from "@/lib/api/summaryN8nService";
import { describe, it, beforeEach, expect, vi } from "vitest";

vi.mock("@/services/api", () => ({
    summaryService: {
        getByDocumentId: vi.fn(),
        delete: vi.fn(),
        downloadDocx: vi.fn(),
    },
    shareService: {
        resolveTokenRole: vi.fn().mockResolvedValue("owner"),
    },
}));

vi.mock("@/lib/api/summaryN8nService", () => ({
    summaryN8nService: {
        createSummary: vi.fn(),
    },
}));

// Mock socket.io-client
vi.mock("socket.io-client", () => ({
    io: vi.fn(() => ({
        on: vi.fn(),
        off: vi.fn(),
        disconnect: vi.fn(),
    })),
}));

const mockDocument = {
    id: "doc123",
    name: "Test Document",
    uploadedAt: "2026-01-01T00:00:00Z",
    type: "DRHP",
};

describe("SummaryPanel component", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (summaryService.getByDocumentId as any).mockResolvedValue([]);
        (summaryN8nService.createSummary as any).mockResolvedValue({});
        (shareService.resolveTokenRole as any).mockResolvedValue("owner");
    });

    it("renders generate button when no summary exists", async () => {
        render(
            <SummaryPanel
                isDocumentProcessed={true}
                currentDocument={mockDocument}
                selectedSummaryId={null}
                onSummarySelect={vi.fn()}
                onProcessingChange={vi.fn()}
            />
        );
        const button = await screen.findByRole("button", { name: /generate new summary/i });
        expect(button).toBeInTheDocument();
    });

    it("calls summary creation when button clicked", async () => {
        render(
            <SummaryPanel
                isDocumentProcessed={true}
                currentDocument={mockDocument}
                selectedSummaryId={null}
                onSummarySelect={vi.fn()}
                onProcessingChange={vi.fn()}
            />
        );
        const button = await screen.findByRole("button", { name: /generate new summary/i });
        fireEvent.click(button);
        await waitFor(() => expect(summaryN8nService.createSummary).toHaveBeenCalled());
    });
});
