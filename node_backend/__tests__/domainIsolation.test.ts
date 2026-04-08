import request from 'supertest';
import { app } from '../index';
import { User } from '../models/User';
import { Document } from '../models/Document';
import { Workspace } from '../models/Workspace';
import jwt from 'jsonwebtoken';

// Mock models
jest.mock('../models/User');
jest.mock('../models/Document');
jest.mock('../models/Workspace');
jest.mock('../models/WorkspaceMembership', () => ({
    WorkspaceMembership: {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null)
    }
}));
jest.mock('../models/Directory', () => ({
    Directory: {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([])
    }
}));
jest.mock('../models/SharePermission', () => ({
    SharePermission: {
        findOne: jest.fn().mockResolvedValue(null)
    }
}));

describe('Multi-Tenancy Domain Isolation', () => {
    const JWT_SECRET = process.env["JWT-SECRET"] || 'test_secret';

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('Security: User from Domain B should NOT be able to access a Document from Domain A', async () => {
        // 1. Setup User B (from tenant-b.com)
        const mockUserB = {
            _id: 'user_b_id',
            domain: 'tenant-b.com',
            domainId: 'tenant-b.com',
            role: 'user',
            status: 'active',
            currentWorkspace: 'workspace_b_id',
            save: jest.fn().mockResolvedValue(true)
        };
        
        (User.findById as jest.Mock).mockReturnValue({
            select: jest.fn().mockResolvedValue(mockUserB)
        });
        (User.findOne as jest.Mock).mockResolvedValue(mockUserB);

        // 2. Setup Workspace B
        const mockWorkspaceB = {
            workspaceId: 'workspace_b_id',
            domain: 'tenant-b.com',
            status: 'active'
        };
        (Workspace.findOne as jest.Mock).mockImplementation((query) => {
            if (query.workspaceId === 'workspace_b_id') return mockWorkspaceB;
            return null;
        });

        // 3. Generate Token for User B
        const tokenB = jwt.sign({ userId: 'user_b_id' }, JWT_SECRET);

        // 4. Setup Mock Document A (owned by tenant-a.com)
        const mockDocumentA = {
            id: 'doc_a_id',
            domain: 'tenant-a.com',
            workspaceId: 'workspace_a_id',
            name: 'Secret Strategy'
        };

        // Mock Document.findOne to simulate missing record when querying with mismatched domain
        (Document.findOne as jest.Mock).mockImplementation((query) => {
            if (query.id === 'doc_a_id' && query.domain === 'tenant-a.com') {
                return mockDocumentA;
            }
            return null;
        });

        // 5. Execution: User B tries to GET Document A by ID
        const response = await request(app)
            .get('/api/documents/doc_a_id')
            .set('Authorization', `Bearer ${tokenB}`)
            .set('x-workspace', 'workspace_b_id');

        // 6. Assertions
        // The middleware or permission check correctly denies access.
        // In the current implementation, if the document is not found in the domain context,
        // it returns a 403.
        expect(response.status).toBe(403);
        // The specific message might come from domainAuth or permissions middleware
        expect(response.body.message).toMatch(/Access denied|Insufficient permissions/);
    });

    it('Security: Same-Domain Admin can see their own domain documents', async () => {
        const adminA = {
            _id: 'admin_a_id',
            domain: 'tenant-a.com',
            domainId: 'tenant-a.com',
            role: 'admin',
            status: 'active',
            currentWorkspace: 'workspace_a_id',
            save: jest.fn().mockResolvedValue(true)
        };
        (User.findById as jest.Mock).mockReturnValue({
            select: jest.fn().mockResolvedValue(adminA)
        });
        (User.findOne as jest.Mock).mockResolvedValue(adminA);
        
        const mockWorkspaceA = {
            workspaceId: 'workspace_a_id',
            domain: 'tenant-a.com',
            status: 'active'
        };
        (Workspace.findOne as jest.Mock).mockResolvedValue(mockWorkspaceA);

        const tokenA = jwt.sign({ userId: 'admin_a_id' }, JWT_SECRET);

        const mockDocumentA = {
            id: 'doc_a_id',
            domain: 'tenant-a.com',
            workspaceId: 'workspace_a_id',
            name: 'Strategy'
        };
        (Document.findOne as jest.Mock).mockResolvedValue(mockDocumentA);

        const response = await request(app)
            .get('/api/documents/doc_a_id')
            .set('Authorization', `Bearer ${tokenA}`)
            .set('x-workspace', 'workspace_a_id');

        expect(response.status).toBe(200);
        expect(response.body.name).toBe('Strategy');
    });
});
