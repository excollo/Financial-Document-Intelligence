import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../index';
import { Document } from '../models/Document';

// Mock mongoose
jest.mock('mongoose', () => {
    const actualMongoose = jest.requireActual('mongoose');
    return {
        ...actualMongoose,
        connect: jest.fn().mockResolvedValue(actualMongoose),
        connection: {
            on: jest.fn(),
            once: jest.fn(),
        },
    };
});

// Mock Document model
jest.mock('../models/Document', () => ({
    Document: {
        find: jest.fn(),
    },
}));

describe('Document Routes', () => {
    afterAll(async () => {
        await mongoose.disconnect();
    });

    it('GET /health - should return 200', async () => {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
    });

    it('GET /api/documents - should handle unauthorized', async () => {
        const response = await request(app).get('/api/documents');
        // If no token is provided, it should be 401
        expect(response.status).toBe(401);
    });
});
