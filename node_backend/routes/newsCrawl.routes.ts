import express from 'express';
import { newsCrawlController } from '../controllers/newsCrawlController';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// POST endpoint for n8n to submit crawl results (no auth for n8n webhooks)
router.post('/submit', newsCrawlController.submitCrawlResults);

// All other routes require authentication
router.use(authMiddleware);

// GET all crawl results with filters
router.get('/', newsCrawlController.getCrawlResults);

// GET dashboard stats
router.get('/dashboard/stats', newsCrawlController.getDashboardStats);

// GET companies list
router.get('/companies', newsCrawlController.getCompaniesList);

// GET single crawl result by ID
router.get('/:id', newsCrawlController.getCrawlResultById);

// GET latest result for a specific company
router.get('/company/:company', newsCrawlController.getLatestForCompany);

export default router;
