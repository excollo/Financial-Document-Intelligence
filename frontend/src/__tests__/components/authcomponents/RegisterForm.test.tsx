import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@/__tests__/utils/test-utils";
import userEvent from "@testing-library/user-event";
import { RegisterForm } from "@/components/authcomponents/RegisterForm";
import { authService } from "@/services/authService";
import { toast } from "sonner";

// Mock dependencies
vi.mock("@/services/authService");
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ search: "" }),
  };
});

describe("RegisterForm", () => {
  const mockRegister = vi.fn();
  const mockVerifyOtp = vi.fn();
  const mockAuthService = authService as {
    register: ReturnType<typeof vi.fn>;
    verifyOtp: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthService.register = vi.fn();
    mockAuthService.verifyOtp = vi.fn();
  });

  it("renders registration form with all fields", () => {
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/your password/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register/i })).toBeInTheDocument();
  });

  it("shows validation error for invalid email", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    const submitButton = screen.getByRole("button", { name: /register/i });

    await user.type(emailInput, "invalid-email");
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
    });
  });

  it("shows validation error when passwords don't match", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByPlaceholderText(/your password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm password/i);
    const submitButton = screen.getByRole("button", { name: /register/i });

    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput, "password123");
    await user.type(confirmPasswordInput, "differentpassword");
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/passwords don't match/i)).toBeInTheDocument();
    });
  });

  it("submits registration form with valid data", async () => {
    const user = userEvent.setup();
    mockAuthService.register.mockResolvedValue({
      message: "OTP sent to email",
    });

    render(<RegisterForm onSwitchToLogin={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByPlaceholderText(/your password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm password/i);
    const submitButton = screen.getByRole("button", { name: /register/i });

    // Use a password that meets all requirements: uppercase, lowercase, number, special char
    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput, "Password123!");
    await user.type(confirmPasswordInput, "Password123!");
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockAuthService.register).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "Password123!",
      });
    });
  });

  it("shows OTP verification step after successful registration", async () => {
    const user = userEvent.setup();
    mockAuthService.register.mockResolvedValue({
      message: "OTP sent to email",
    });

    render(<RegisterForm onSwitchToLogin={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByPlaceholderText(/your password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm password/i);
    const submitButton = screen.getByRole("button", { name: /register/i });

    // Use a password that meets all requirements
    await user.type(emailInput, "test@example.com");
    await user.type(passwordInput, "Password123!");
    await user.type(confirmPasswordInput, "Password123!");
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Enter OTP sent to/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/6-digit OTP/i)).toBeInTheDocument();
    });
  });

  it("handles registration error for existing user", async () => {
    const user = userEvent.setup();
    const onSwitchToLogin = vi.fn();
    mockAuthService.register.mockRejectedValue({
      response: { data: { message: "User already exists" } },
    });

    render(<RegisterForm onSwitchToLogin={onSwitchToLogin} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByPlaceholderText(/your password/i);
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm password/i);
    const submitButton = screen.getByRole("button", { name: /register/i });

    // Use a password that meets all requirements
    await user.type(emailInput, "existing@example.com");
    await user.type(passwordInput, "Password123!");
    await user.type(confirmPasswordInput, "Password123!");
    await user.click(submitButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    }, { timeout: 3000 });
  });

  it("toggles password visibility for both password fields", async () => {
    const user = userEvent.setup();
    render(<RegisterForm onSwitchToLogin={vi.fn()} />);

    const passwordInput = screen.getByPlaceholderText(/your password/i) as HTMLInputElement;
    const confirmPasswordInput = screen.getByPlaceholderText(/confirm password/i) as HTMLInputElement;

    // Find toggle buttons by finding buttons inside the password input containers
    const passwordContainer = passwordInput.closest(".relative");
    const confirmPasswordContainer = confirmPasswordInput.closest(".relative");
    const passwordToggle = passwordContainer?.querySelector("button[type='button']") as HTMLButtonElement;
    const confirmPasswordToggle = confirmPasswordContainer?.querySelector("button[type='button']") as HTMLButtonElement;

    expect(passwordInput.type).toBe("password");
    expect(confirmPasswordInput.type).toBe("password");
    expect(passwordToggle).toBeInTheDocument();
    expect(confirmPasswordToggle).toBeInTheDocument();

    await user.click(passwordToggle!);
    expect(passwordInput.type).toBe("text");

    await user.click(confirmPasswordToggle!);
    expect(confirmPasswordInput.type).toBe("text");
  });
});

