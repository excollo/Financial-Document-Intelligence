// src/components/authcomponents/__tests__/RegisterForm.test.tsx
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RegisterForm } from "../RegisterForm";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { authService } from "@/services/authService";

// Mock authService
vi.mock("@/services/authService", () => ({
    authService: {
        register: vi.fn(),
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

describe("RegisterForm component", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const renderRegisterForm = () => {
        return render(
            <BrowserRouter>
                <RegisterForm onSwitchToLogin={vi.fn()} />
            </BrowserRouter>
        );
    };

    it("renders register form fields", () => {
        renderRegisterForm();
        expect(screen.getByPlaceholderText(/your email/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/your password/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText(/confirm password/i)).toBeInTheDocument();
    });

    it("calls register service with form data", async () => {
        (authService.register as any).mockResolvedValue({ success: true });
        renderRegisterForm();

        fireEvent.change(screen.getByPlaceholderText(/your email/i), { target: { value: "john@example.com" } });
        fireEvent.change(screen.getByPlaceholderText(/your password/i), { target: { value: "Password123!" } });
        fireEvent.change(screen.getByPlaceholderText(/confirm password/i), { target: { value: "Password123!" } });

        fireEvent.click(screen.getByRole("button", { name: /register/i }));

        await waitFor(() => {
            expect(authService.register).toHaveBeenCalledWith({
                email: "john@example.com",
                password: "Password123!",
            });
        });
    });
});
