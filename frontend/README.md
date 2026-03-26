## 📋 Overview

The **Smart RHP Pilot** is the professional user interface for the platform. Built with **React** and **Tailwind CSS**, it provides a high-fidelity dashboard for institutional investors to manage, analyze, and chat with financial prospectus documents (DRHP/RHP).

### Key Features

- ✅ **Unified Dashboard**: Manage complex document hierarchies and multi-page PDFs.
- ✅ **High-Fidelity Summaries**: Interactive, styled HTML summaries with fund-specific math.
- ✅ **RAG Document Chat**: Context-aware conversational interface with source citations.
- ✅ **Domain-Aware Config**: Dynamic UI changes based on fund-specific SOPs and checklists.
- ✅ **Playwright E2E**: Comprehensive end-to-end testing suite for the "Gold Path" user journey.

## Main Pages & User Flows

- **Landing Page**: Introduction and call to action
- **Login/Register**: Secure authentication (email/password or Microsoft)
- **Dashboard**: Upload, view, rename, and delete documents
- **Document Chat**: Chat with your document and view summaries
- **Chat History**: Review past conversations
- **Settings**: Manage your account and preferences
- **404 Not Found**: Error page for invalid routes

## Tech Stack

### Core Technologies
- **React** + **TypeScript** - UI framework with type safety
- **Vite** - Fast build tool and dev server
- **Tailwind CSS** + **shadcn-ui** - Modern UI components and styling
- **React Router** - Client-side routing
- **Axios** - HTTP client for API requests
- **@tanstack/react-query** - Data fetching, caching, and synchronization

### Testing Stack
- **Vitest** - Fast unit test runner (Vite-native)
- **React Testing Library** - Component testing utilities
- **@testing-library/user-event** - User interaction simulation
- **@testing-library/jest-dom** - Custom DOM matchers
- **MSW (Mock Service Worker)** - API mocking for integration tests
- **@vitest/coverage-v8** - Code coverage reporting

## Getting Started

### Prerequisites

- **Node.js** (v18 or higher) & **npm** installed

### Setup

1. **Clone the repository:**
   ```sh
   git clone <YOUR_GIT_URL>
   cd smart-rhp-pilot
   ```

2. **Install dependencies:**
   ```sh
   npm install
   ```

3. **Set up environment variables:**
   ```sh
   cp .env.example .env
   ```
   Edit `.env` and configure your API URLs and N8N webhook endpoints.

4. **Start the development server:**
   ```sh
   npm run dev
   ```
   The app will be available at `http://localhost:8080`

## Available Commands

### Development Commands

```sh
# Start development server
npm run dev

# Build for production
npm run build

# Build for development mode
npm run build:dev

# Preview production build locally
npm run preview

# Run ESLint
npm run lint
```

### Testing Commands

```sh
# Run tests in watch mode (interactive)
npm run test

# Run tests once (CI mode)
npm run test:run

# Run tests with UI dashboard
npm run test:ui

# Run tests with code coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Test Coverage

- **Components**: Unit and integration tests for React components
- **Services**: API service layer tests
- **Utilities**: Helper functions and utilities tests
- **Coverage Reports**: Generated in `coverage/` directory after running `npm run test:coverage`

## Environment Variables

Create a `.env` file in the root directory. The primary configuration is the `VITE_API_URL` which connects to the Node.js backend.

```env
# Primary API Configuration (Node.js Gateway)
# This handles authentication, document management, and AI job orchestration.
VITE_API_URL=http://localhost:5000/api

# Legacy/Optional: Direct N8N Webhook URLs
# (Note: Most features have migrated to the Python AI service via the Node.js API)
VITE_N8N_CHAT_DRHP_WEBHOOK_URL=...
VITE_N8N_SUMMARY_DRHP_WEBHOOK_URL=...
VITE_N8N_REPORT_WEBHOOK_URL=...
```

> **Note**: See `.env.example` for a template with all available environment variables.

## Testing

### Test Structure

```
src/__tests__/
├── setup.ts                    # Test configuration and global mocks
├── utils/
│   └── test-utils.tsx          # Custom render function and test utilities
├── mocks/
│   └── handlers.ts             # MSW API mock handlers
├── components/
│   └── authcomponents/        # Component tests
│       ├── LoginForm.test.tsx
│       └── RegisterForm.test.tsx
├── services/                   # Service/API tests
│   └── authService.test.ts
└── lib/
    └── api/                    # API utility tests
        └── uploadService.test.ts
```

### Writing Tests

#### Component Tests

Test React components with user interactions:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@/__tests__/utils/test-utils';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '@/components/authcomponents/LoginForm';

describe('LoginForm', () => {
  it('renders login form correctly', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
```

#### Service Tests

Test API services and utilities:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { authService } from '@/services/authService';

describe('authService', () => {
  it('calls correct endpoint', async () => {
    // Test implementation
  });
});
```

### Test Coverage Goals

- **Components**: 80%+ coverage
- **Services**: 90%+ coverage
- **Utilities**: 100% coverage

For detailed testing documentation, see [`src/__tests__/README.md`](./src/__tests__/README.md).

## Project Structure

```
smart-rhp-pilot/
├── src/
│   ├── components/            # React components
│   │   ├── authcomponents/   # Authentication components
│   │   ├── chatcomponents/   # Chat-related components
│   │   ├── documentcomponents/ # Document management components
│   │   ├── workspacecomponents/ # Workspace management components
│   │   ├── sharedcomponents/ # Shared/reusable components
│   │   └── ui/               # shadcn/ui components
│   ├── pages/                # Page components
│   │   ├── authpages/        # Authentication pages
│   │   ├── chatpages/        # Chat pages
│   │   ├── documentpages/    # Document pages
│   │   ├── workspacepages/   # Workspace pages
│   │   ├── adminpages/       # Admin pages
│   │   └── sharedpages/      # Shared pages
│   ├── services/             # API services
│   ├── contexts/             # React contexts
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utilities and helpers
│   │   └── api/              # API utilities (n8n services, etc.)
│   └── __tests__/            # Test files
├── public/                    # Static assets
├── .env                      # Environment variables (not in git)
├── .env.example              # Environment variables template
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript configuration
└── package.json              # Dependencies and scripts
```

## Development Workflow

1. **Create a feature branch:**
   ```sh
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes and test:**
   ```sh
   npm run dev          # Test in browser
   npm run test:watch   # Run tests in watch mode
   ```

3. **Ensure tests pass:**
   ```sh
   npm run test:run
   npm run lint
   ```

4. **Check coverage:**
   ```sh
   npm run test:coverage
   ```

5. **Build and verify:**
   ```sh
   npm run build
   npm run preview
   ```

## Troubleshooting

### Tests failing with "Cannot find module"
- Ensure path alias `@/` is correctly configured in `vite.config.ts` and `tsconfig.json`
- Check that imports use the `@/` alias for internal modules

### Environment variables not loading
- Ensure `.env` file exists in the root directory
- Restart the dev server after changing `.env` variables
- Variables must be prefixed with `VITE_` to be accessible in the frontend

### Port already in use
- Change the port in `vite.config.ts` or kill the process using port 8080

## License

MIT
