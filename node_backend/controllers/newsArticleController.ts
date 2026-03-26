import { Request, Response } from 'express';
import NewsArticle from '../models/NewsArticle';
import NewsCrawlResult from '../models/NewsCrawlResult';

export const newsArticleController = {
    // POST endpoint for n8n to submit news articles
    async submitNewsArticles(req: Request, res: Response) {
        try {
            const articles = req.body;

            // Get workspace and domain from headers or body defaults
            const workspaceId = (req.headers['x-workspace'] as string) ||
                req.body.workspaceId ||
                'ws_1758689602670_z3pxonjqn';
            const domainId = (req.headers['x-domain'] as string) ||
                req.body.domainId ||
                'domain_excollo-com_1762104581969';

            // Handle both single article and array of articles
            const articlesArray = Array.isArray(articles) ? articles : [articles];

            const savedArticles = [];

            for (const article of articlesArray) {
                try {
                    // Create or update article (upsert by URL to avoid duplicates)
                    const newsArticle = await NewsArticle.findOneAndUpdate(
                        { url: article.url },
                        {
                            title: article.title,
                            description: article.description,
                            url: article.url,
                            imageUrl: article.imageUrl || article.image_url,
                            source: article.source,
                            publishedDate: new Date(article.published_date || article.publishedDate || Date.now()),
                            company: article.company,
                            category: article.category,
                            sentiment: article.sentiment,
                            riskLevel: article.risk_level || article.riskLevel,
                            findings: article.finding || article.findings,
                            workspaceId,
                            domainId,
                            crawledAt: new Date(),
                        },
                        {
                            upsert: true,
                            new: true,
                            setDefaultsOnInsert: true,
                        }
                    );

                    savedArticles.push(newsArticle);
                } catch (err: any) {
                    console.error('Error saving article:', err);
                    // Continue with next article even if one fails
                }
            }

            res.status(201).json({
                message: 'News articles saved successfully',
                count: savedArticles.length,
                articles: savedArticles,
            });
        } catch (error: any) {
            console.error('Error saving news articles:', error);
            res.status(500).json({
                message: 'Error saving news articles',
                error: error.message,
            });
        }
    },

    // GET all news articles with filters
    async getNewsArticles(req: Request, res: Response) {
        try {
            const {
                company,
                sentiment,
                riskLevel,
                category,
                source,
                startDate,
                endDate,
                search,
                page = 1,
                limit = 20,
            } = req.query;

            const workspaceId = req.headers['x-workspace'] as string;

            if (!workspaceId) {
                return res.status(400).json({ message: 'Workspace ID required' });
            }

            // Build query
            const query: any = { workspaceId };

            if (company) {
                query.company = { $regex: company, $options: 'i' };
            }

            if (sentiment) {
                query.sentiment = sentiment;
            }

            if (riskLevel) {
                query.riskLevel = riskLevel;
            }

            if (category) {
                query.category = category;
            }

            if (source) {
                query.source = { $regex: source, $options: 'i' };
            }

            if (search) {
                query.$or = [
                    { title: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } },
                ];
            }

            if (startDate || endDate) {
                query.crawledAt = {};
                if (startDate) query.crawledAt.$gte = new Date(startDate as string);
                if (endDate) query.crawledAt.$lte = new Date(endDate as string);
            }

            // Execute query with pagination
            const skip = (Number(page) - 1) * Number(limit);

            const articles = await NewsArticle.find(query)
                .sort({ crawledAt: -1 })
                .skip(skip)
                .limit(Number(limit));

            const total = await NewsArticle.countDocuments(query);

            res.json({
                articles,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error: any) {
            console.error('Error fetching news articles:', error);
            res.status(500).json({
                message: 'Error fetching news articles',
                error: error.message,
            });
        }
    },

    // GET dashboard stats for news articles
    async getArticleStats(req: Request, res: Response) {
        try {
            const workspaceId = req.headers['x-workspace'] as string;
            const { startDate, endDate } = req.query;

            if (!workspaceId) {
                return res.status(400).json({ message: 'Workspace ID required' });
            }

            // Build base query with date filters if provided
            const baseQuery: any = { workspaceId };
            if (startDate || endDate) {
                baseQuery.crawledAt = {};
                if (startDate) baseQuery.crawledAt.$gte = new Date(startDate as string);
                if (endDate) baseQuery.crawledAt.$lte = new Date(endDate as string);
            }

            const [
                totalArticles,
                sentimentCounts,
                riskCounts,
                companyCounts,
                recentArticles,
            ] = await Promise.all([
                NewsArticle.countDocuments(baseQuery),
                NewsArticle.aggregate([
                    { $match: baseQuery },
                    { $group: { _id: '$sentiment', count: { $sum: 1 } } },
                ]),
                NewsArticle.aggregate([
                    { $match: { ...baseQuery, riskLevel: { $exists: true } } },
                    { $group: { _id: '$riskLevel', count: { $sum: 1 } } },
                ]),
                NewsArticle.aggregate([
                    { $match: baseQuery },
                    { $group: { _id: '$company', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 10 },
                ]),
                NewsArticle.find(baseQuery)
                    .sort({ crawledAt: -1 })
                    .limit(5),
            ]);

            // Format sentiment counts
            const sentimentSummary = {
                positive: 0,
                negative: 0,
                neutral: 0,
            };
            sentimentCounts.forEach((item: any) => {
                sentimentSummary[item._id as keyof typeof sentimentSummary] = item.count;
            });

            // Format risk counts
            const riskDistribution = {
                LOW: 0,
                MEDIUM: 0,
                HIGH: 0,
                CRITICAL: 0,
            };
            riskCounts.forEach((item: any) => {
                riskDistribution[item._id as keyof typeof riskDistribution] = item.count;
            });

            res.json({
                totalArticles,
                sentimentSummary,
                riskDistribution,
                topCompanies: companyCounts,
                recentArticles,
                lastCrawlDate: recentArticles[0]?.crawledAt || null,
            });
        } catch (error: any) {
            console.error('Error fetching article stats:', error);
            res.status(500).json({
                message: 'Error fetching article stats',
                error: error.message,
            });
        }
    },

    // GET single article by ID
    async getArticleById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const workspaceId = req.headers['x-workspace'] as string;

            const article = await NewsArticle.findOne({
                _id: id,
                workspaceId,
            });

            if (!article) {
                return res.status(404).json({ message: 'Article not found' });
            }

            res.json(article);
        } catch (error: any) {
            console.error('Error fetching article:', error);
            res.status(500).json({
                message: 'Error fetching article',
                error: error.message,
            });
        }
    },

    // GET articles by company
    async getArticlesByCompany(req: Request, res: Response) {
        try {
            const { company } = req.params;
            const { page = 1, limit = 20 } = req.query;
            const workspaceId = req.headers['x-workspace'] as string;

            const skip = (Number(page) - 1) * Number(limit);

            const articles = await NewsArticle.find({
                company: { $regex: company, $options: 'i' },
                workspaceId,
            })
                .sort({ publishedDate: -1 })
                .skip(skip)
                .limit(Number(limit));

            const total = await NewsArticle.countDocuments({
                company: { $regex: company, $options: 'i' },
                workspaceId,
            });

            res.json({
                articles,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error: any) {
            console.error('Error fetching company articles:', error);
            res.status(500).json({
                message: 'Error fetching company articles',
                error: error.message,
            });
        }
    },

    // DELETE article by ID
    async deleteArticle(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const workspaceId = req.headers['x-workspace'] as string;

            if (!workspaceId) {
                return res.status(400).json({ message: 'Workspace ID required' });
            }

            const result = await NewsArticle.findOneAndDelete({
                _id: id,
                workspaceId
            });

            if (!result) {
                return res.status(404).json({ message: 'Article not found or access denied' });
            }

            res.json({ message: 'Article deleted successfully' });
        } catch (error: any) {
            console.error('Error deleting article:', error);
            res.status(500).json({
                message: 'Error deleting article',
                error: error.message,
            });
        }
    }
};
