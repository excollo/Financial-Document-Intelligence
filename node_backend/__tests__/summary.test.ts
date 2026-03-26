import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../index';
import { Summary } from '../models/Summary';

// Mock mongoose
jest.mock('mongoose', () => {
    const actualMongoose = jest.requireActual('mongoose');
    return {
        ...actualMongoose,
        connect: jest.fn().mockResolvedValue({}),
        connection: {
            on: jest.fn(),
            once: jest.fn(),
        },
        disconnect: jest.fn().mockResolvedValue({}),
    };
});

// Mock Summary model
jest.mock('../models/Summary', () => ({
    Summary: {
        find: jest.fn(),
        findOne: jest.fn(),
    },
}));

describe('Summary Routes', () => {
    afterAll(async () => {
        await mongoose.disconnect();
    });

    it('GET /api/summaries/document/:documentId - should return 401 if unauthorized', async () => {
        const response = await request(app).get('/api/summaries/document/doc123');
        expect(response.status).toBe(401);
    });
});
