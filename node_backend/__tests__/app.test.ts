// __tests__/app.test.ts
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../index';

// Mock mongoose to prevent actual DB connection during tests
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

describe('Express app sanity checks', () => {
    afterAll(async () => {
        // Ensure any open handles are closed if possible, though we mocked connect
        await mongoose.disconnect();
    });

    it('should be an Express instance', () => {
        expect(app).toBeDefined();
        expect(typeof (app as any).use).toBe('function');
    });

    it('should return 404 for unknown route', async () => {
        // We use a small timeout to avoid hangs if something is still pending
        const response = await request(app).get('/nonexistent');
        expect(response.status).toBe(404);
    });
});
