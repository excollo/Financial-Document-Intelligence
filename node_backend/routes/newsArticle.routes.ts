import express from 'express';
import { newsArticleController } from '../controllers/newsArticleController';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

// POST endpoint for n8n to submit news articles (no auth for n8n webhooks)
router.post('/submit', newsArticleController.submitNewsArticles);

// All other routes require authentication
router.use(authMiddleware);

// GET all news articles with filters
router.get('/', newsArticleController.getNewsArticles);

// GET dashboard stats for articles
router.get('/stats', newsArticleController.getArticleStats);

// GET single article by ID
router.get('/:id', newsArticleController.getArticleById);

// GET articles by company
router.get('/company/:company', newsArticleController.getArticlesByCompany);

// DELETE article by ID
router.delete('/:id', newsArticleController.deleteArticle);

export default router;
