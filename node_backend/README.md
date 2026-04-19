## 📋 Overview

The **Smart RHTP Backend** serves as the central **API Gateway** and business logic layer for the platform. It manages user authentication, multi-tenant workspace isolation, and orchestrates high-fidelity AI requests by delegating them to the specialized Python AI service.

### Key Features

- ✅ **API Gateway**: Unified entry point for Frontend and Mobile clients.
- ✅ **Domain Isolation**: Secure, multi-tenant configuration for different investment funds.
- ✅ **Secure Job Submission**: Asynchronous job handling via the Python backend.
- ✅ **Real-time Notifications**: Live updates and status tracking via **Socket.IO**.
- ✅ **Audit Logging**: Comprehensive tracking of document uploads and AI generations.

---

## 🔒 Internal Security Model

To protect the infrastructure, communication between the Node.js and Python platforms is secured via:

- **Shared Secret Auth**: All inter-service requests require an `X-Internal-Secret` header.
- **Environment Isolation**: The `INTERNAL_SECRET` must be set in both services' `.env` files.
- **Tenant Context**: Every job submission includes a `tenant_id` and `domainId` to ensure strict data scoping.

---

### Auth

- `POST /api/auth/register` — Register a new user
- `POST /api/auth/login` — Login with email/password
- `POST /api/auth/refresh-token` — Refresh JWT access token
- `POST /api/auth/logout` — Logout and invalidate refresh token
- `GET /api/auth/microsoft` — Microsoft OAuth login URL
- `GET /api/auth/callback` — Microsoft OAuth callback
- `GET /api/auth/me` — Get current user info
- `GET /api/auth/history` — Get user's documents, summaries, and chats

### Documents

- `GET /api/documents/` — List all documents for the user
- `GET /api/documents/:id` — Get a single document
- `POST /api/documents/` — Create a document record
- `POST /api/documents/upload` — Upload a PDF file
- `GET /api/documents/download/:id` — Download/view a PDF file
- `PUT /api/documents/:id` — Update document metadata
- `DELETE /api/documents/:id` — Delete a document

### Summaries

- `GET /api/summaries/` — List all summaries for the user
- `GET /api/summaries/document/:documentId` — Get summaries for a document
- `POST /api/summaries/` — Create a new summary
- `PUT /api/summaries/:id` — Update a summary
- `DELETE /api/summaries/:id` — Delete a summary

### Chats

- `GET /api/chats/` — List all chats for the user
- `GET /api/chats/document/:documentId` — Get chat history for a document
- `POST /api/chats/` — Create a new chat
- `POST /api/chats/:chatId/messages` — Add a message to a chat
- `PUT /api/chats/:id` — Update a chat
- `DELETE /api/chats/:id` — Delete a chat

## Data Models

- **User**: Microsoft or email/password, with refresh tokens
- **Document**: PDF file (stored in Azure Blob Storage), metadata, user association
- **Summary**: AI-generated summary, linked to document and user
- **Chat**: Conversation history, linked to document and user

## Tech Stack

- Node.js, Express, TypeScript
- MongoDB
- Azure Blob Storage for file storage
- Passport.js (Microsoft OAuth)
- JWT authentication
- Multer (file uploads, via multer-s3)
- Azure SDK for JS (@azure/storage-blob)
- Axios, FormData

## Setup

1. Install dependencies: `npm install`
2. Set environment variables in `.env` (see below)
3. Start in dev mode: `npm run dev`
4. Build: `npm run build` (output in `dist/`)
5. Start production: `npm start`

### Example .env

```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/smart-rhp
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_jwt_refresh_secret
CLIENT_ID=your_microsoft_client_id
CLIENT_SECRET=your_microsoft_client_secret
REDIRECT_URI=https://smart-rhtp-backend-2.onrender.com/api/auth/callback
FRONTEND_URL=https://financial-document-intelligence.vercel.app/

# Azure Blob Storage configuration
AZURE_BLOB_ACCOUNT_NAME=your_account_name
AZURE_BLOB_ACCOUNT_KEY=your_account_key
AZURE_BLOB_STORAGE_CONNECTION_STRING=your_connection_string
AZURE_BLOB_CONTAINER_NAME=drhp-files
```

## Password Reset

- `POST /api/auth/forgot-password` — Request a password reset (email/password users only)
  - Body: `{ email: string }`
  - Always returns success message for privacy.
- `POST /api/auth/reset-password` — Reset password with token (email/password users only)
  - Body: `{ email: string, token: string, password: string }`
  - Returns success or error if token is invalid/expired.
- **Microsoft users:** Please reset your password using your Microsoft account provider. This backend does not handle Microsoft password resets.

## License

MIT
