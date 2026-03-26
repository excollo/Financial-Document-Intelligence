// src/components/authcomponents/__tests__/LoginForm.test.tsx
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LoginForm } from "../LoginForm";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "@/services/authService";

// Mock authService
vi.mock("@/services/authService", () => ({
    authService: {
        login: vi.fn(),
    },
}));

// Mock useAuth from context
vi.mock("@/contexts/AuthContext", () => ({
    useAuth: () => ({
        login: vi.fn(),
        logout: vi.fn(),
        user: null,
        isAuthenticated: false,
        loading: false,
    }),
}));

// Mock sonner
vi.mock("sonner", () => ({
    toast: {
        error: vi.fn(),
        success: vi.fn(),
        info: vi.fn(),
    },
}));

describe("LoginForm component", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderLoginForm = () => {
        return render(
            <BrowserRouter>
                <LoginForm />
            </BrowserRouter>
        );
    };

    it("renders login form correctly", () => {
        renderLoginForm();
        expect(screen.getByPlaceholderText(/your email/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/your password/i)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /log in/i })).toBeInTheDocument();
    });

    it("calls login service on form submission", async () => {
        (authService.login as any).mockResolvedValue({
            accessToken: "access", refreshToken: "refresh"
        });
        renderLoginForm();

        fireEvent.change(screen.getByPlaceholderText(/your email/i), { target: { value: "test@example.com" } });
        fireEvent.change(screen.getByPlaceholderText(/your password/i), { target: { value: "password123" } });
        fireEvent.click(screen.getByRole("button", { name: /log in/i }));

        await waitFor(() => {
            expect(authService.login).toHaveBeenCalledWith(
                "test@example.com",
                "password123",
            );
        });
    });
});
