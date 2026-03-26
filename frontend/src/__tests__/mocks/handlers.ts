import { http, HttpResponse } from "msw";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export const handlers = [
  // Auth endpoints
  http.post(`${API_URL}/auth/login`, () => {
    return HttpResponse.json({
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
      },
    });
  }),

  http.post(`${API_URL}/auth/register`, () => {
    return HttpResponse.json({
      message: "Registration successful. OTP sent to email.",
    });
  }),

  http.post(`${API_URL}/auth/verify-otp`, () => {
    return HttpResponse.json({
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      user: {
        id: "user-1",
        email: "test@example.com",
        name: "Test User",
      },
    });
  }),

  http.post(`${API_URL}/auth/forgot-password`, () => {
    return HttpResponse.json({
      message: "Password reset email sent",
    });
  }),

  http.post(`${API_URL}/auth/reset-password`, () => {
    return HttpResponse.json({
      message: "Password reset successful",
    });
  }),

  // Document endpoints
  http.get(`${API_URL}/documents`, () => {
    return HttpResponse.json({
      documents: [
        {
          id: "doc-1",
          name: "Test Document.pdf",
          namespace: "Test Document.pdf",
          type: "DRHP",
          status: "completed",
          uploadedAt: new Date().toISOString(),
        },
      ],
    });
  }),

  http.post(`${API_URL}/documents/upload`, () => {
    return HttpResponse.json({
      success: true,
      documentId: "doc-1",
      namespace: "Test Document.pdf",
      status: "processing",
    });
  }),

  // Workspace endpoints
  http.get(`${API_URL}/workspaces`, () => {
    return HttpResponse.json({
      workspaces: [
        {
          id: "workspace-1",
          name: "Test Workspace",
          domain: "example.com",
        },
      ],
    });
  }),
];













