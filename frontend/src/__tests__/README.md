# Frontend Test Suite

This directory contains all frontend tests for the RHP Document application.

## Test Structure

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

## Running Tests

```bash
# Run tests in watch mode
npm run test

# Run tests once
npm run test:run

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Test Utilities

### Custom Render

The `test-utils.tsx` file provides a custom `render` function that includes all necessary providers:

- React Router (BrowserRouter)
- TanStack Query (QueryClientProvider)
- Auth Context (AuthProvider)
- Toast notifications (Toaster)

```typescript
import { render, screen } from '../utils/test-utils';

test('example', () => {
  render(<MyComponent />);
  expect(screen.getByText('Hello')).toBeInTheDocument();
});
```

## Writing Tests

### Component Tests

Component tests should focus on:
- Rendering and visibility
- User interactions
- Form validation
- Error handling
- Loading states

Example:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '../utils/test-utils';
import userEvent from '@testing-library/user-event';
import { MyComponent } from '@/components/MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('handles user interaction', async () => {
    const user = userEvent.setup();
    render(<MyComponent />);
    
    const button = screen.getByRole('button');
    await user.click(button);
    
    expect(screen.getByText('Clicked')).toBeInTheDocument();
  });
});
```

### Service Tests

Service tests should focus on:
- API calls
- Request/response handling
- Error scenarios
- Data transformation

Example:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { myService } from '@/services/myService';
import axios from 'axios';

vi.mock('axios');

describe('myService', () => {
  it('calls correct endpoint', async () => {
    const mockResponse = { data: { result: 'success' } };
    (axios.get as any).mockResolvedValue(mockResponse);
    
    const result = await myService.getData();
    
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/api/data'));
    expect(result).toEqual(mockResponse.data);
  });
});
```

## Mocking

### API Calls

Use MSW (Mock Service Worker) for API mocking in integration tests:

```typescript
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/documents', () => {
    return HttpResponse.json({ documents: [] });
  }),
];
```

### Modules

Use Vitest's `vi.mock()` for module mocking:

```typescript
vi.mock('@/services/authService', () => ({
  authService: {
    login: vi.fn(),
  },
}));
```

## Best Practices

1. **Test user behavior, not implementation details**
2. **Use semantic queries** (`getByRole`, `getByLabelText`) over `getByTestId`
3. **Keep tests isolated** - each test should be independent
4. **Mock external dependencies** - don't make real API calls in tests
5. **Test error cases** - not just happy paths
6. **Use descriptive test names** - they should read like documentation

## Coverage Goals

- **Components**: 80%+ coverage
- **Services**: 90%+ coverage
- **Utilities**: 100% coverage

## Troubleshooting

### Tests failing with "Cannot find module"

Make sure the path alias `@/` is correctly configured in `vite.config.ts` and `tsconfig.json`.

### Tests timing out

Increase timeout for slow tests:
```typescript
it('slow test', async () => {
  // ...
}, { timeout: 10000 });
```

### Mock not working

Ensure mocks are set up before imports:
```typescript
vi.mock('@/services/authService'); // Must be before import
import { authService } from '@/services/authService';
```













