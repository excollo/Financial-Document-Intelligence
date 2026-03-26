import { Request, Response } from 'express';
import NewsArticle from '../models/NewsArticle';

export const newsCrawlController = {
    // POST endpoint for n8n to submit crawl results
    async submitCrawlResults(req: Request, res: Response) {
        try {
            // Body should be array of source objects: [{ sourceType, summary, articles[] }]
            const sourceDataArray = req.body;

            // Get workspace and domain from headers
            const workspaceId = (req.headers['x-workspace'] as string) || 'ws_1758689602670_z3pxonjqn';
            const domainId = (req.headers['x-domain'] as string) || 'domain_excollo-com_1762104581969';

            // Ensure we have an array
            const sourcesArray = Array.isArray(sourceDataArray) ? sourceDataArray : [sourceDataArray];

            const savedArticles = [];

            // Helper function to safely parse date
            const parseDate = (dateValue: any): Date => {
                if (!dateValue) {
                    return new Date(); // Default to now
                }
                const parsed = new Date(dateValue);
                if (isNaN(parsed.getTime())) {
                    return new Date(); // Default to now if invalid
                }
                return parsed;
            };

            // Helper function to extract company from title
            const extractCompany = (title: string): string => {
                // Try to extract company name from title (usually before the colon or dash)
                const patterns = [/^([^:]+):/, /^([^-]+)-/, /^([^|]+)\|/];

                for (const pattern of patterns) {
                    const match = title.match(pattern);
                    if (match) {
                        return match[1].trim();
                    }
                }

                // Fallback: use first few words
                const words = title.split(' ');
                return words.slice(0, Math.min(3, words.length)).join(' ');
            };

            // Helper function to map severity to risk level
            const mapSeverityToRiskLevel = (severity: string): string => {
                if (!severity) return 'MEDIUM';
                const severityLower = severity.toLowerCase();
                if (severityLower === 'high' || severityLower === 'critical') return 'HIGH';
                if (severityLower === 'medium') return 'MEDIUM';
                if (severityLower === 'low') return 'LOW';
                return 'MEDIUM';
            };

            // Process each source data object
            for (const sourceData of sourcesArray) {
                try {
                    // Each sourceData has articles[]
                    if (sourceData.articles && Array.isArray(sourceData.articles)) {
                        for (const article of sourceData.articles) {
                            try {
                                // Extract company from title
                                const company = extractCompany(article.title || 'Unknown Company');

                                // Build description from keyPoints if available
                                let description = article.title || '';
                                if (article.keyPoints && Array.isArray(article.keyPoints)) {
                                    description = article.keyPoints.join(' • ');
                                }

                                // Map sentiment
                                const sentiment = (article.sentiment || 'neutral').toLowerCase();

                                // Create or update the article
                                const newsArticle = await NewsArticle.findOneAndUpdate(
                                    { url: article.url },
                                    {
                                        title: article.title,
                                        description: description,
                                        url: article.url,
                                        imageUrl: article.imageUrl || '',
                                        source: sourceData.sourceType || 'rss',
                                        publishedDate: parseDate(article.publishedDate),
                                        company: company,
                                        category: article.riskType || 'General',
                                        sentiment: sentiment as 'positive' | 'negative' | 'neutral',
                                        riskLevel: mapSeverityToRiskLevel(article.severity),
                                        findings: description,
                                        confidence: article.confidence || 'medium',
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
                            } catch (articleError: any) {
                                console.error('Error saving individual article:', articleError);
                                // Continue processing other articles
                            }
                        }
                    }
                } catch (error: any) {
                    console.error('Error processing source data:', error);
                    // Continue with next source
                }
            }

            res.status(201).json({
                message: 'Crawl results and articles saved successfully',
                articlesCount: savedArticles.length,
                articles: savedArticles,
            });
        } catch (error: any) {
            console.error('Error saving crawl results:', error);
            res.status(500).json({
                message: 'Error saving crawl results',
                error: error.message,
            });
        }
    },

    // GET all crawl results with filters
    async getCrawlResults(req: Request, res: Response) {
        try {
            const { company, riskLevel, sentiment, limit = 50, skip = 0 } = req.query;

            // Build filter query
            const filter: any = {};

            if (company) {
                filter.company = { $regex: company, $options: 'i' };
            }
            if (riskLevel) {
                filter.riskLevel = riskLevel;
            }
            if (sentiment) {
                filter.sentiment = sentiment;
            }

            const articles = await NewsArticle.find(filter)
                .sort({ crawledAt: -1 })
                .limit(Number(limit))
                .skip(Number(skip));

            const total = await NewsArticle.countDocuments(filter);

            res.status(200).json({
                articles,
                total,
                limit: Number(limit),
                skip: Number(skip),
            });
        } catch (error: any) {
            console.error('Error fetching crawl results:', error);
            res.status(500).json({
                message: 'Error fetching crawl results',
                error: error.message,
            });
        }
    },

    // GET dashboard stats
    async getDashboardStats(req: Request, res: Response) {
        try {
            const total = await NewsArticle.countDocuments();
            const highRisk = await NewsArticle.countDocuments({ riskLevel: 'HIGH' });
            const mediumRisk = await NewsArticle.countDocuments({ riskLevel: 'MEDIUM' });
            const lowRisk = await NewsArticle.countDocuments({ riskLevel: 'LOW' });

            const sentimentStats = await NewsArticle.aggregate([
                {
                    $group: {
                        _id: '$sentiment',
                        count: { $sum: 1 },
                    },
                },
            ]);

            res.status(200).json({
                total,
                riskLevels: {
                    high: highRisk,
                    medium: mediumRisk,
                    low: lowRisk,
                },
                sentiment: sentimentStats.reduce((acc: any, item: any) => {
                    acc[item._id] = item.count;
                    return acc;
                }, {}),
            });
        } catch (error: any) {
            console.error('Error fetching dashboard stats:', error);
            res.status(500).json({
                message: 'Error fetching dashboard stats',
                error: error.message,
            });
        }
    },

    // GET companies list
    async getCompaniesList(req: Request, res: Response) {
        try {
            const companies = await NewsArticle.distinct('company');
            res.status(200).json({ companies });
        } catch (error: any) {
            console.error('Error fetching companies list:', error);
            res.status(500).json({
                message: 'Error fetching companies list',
                error: error.message,
            });
        }
    },

    // GET single crawl result by ID
    async getCrawlResultById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const article = await NewsArticle.findById(id);

            if (!article) {
                return res.status(404).json({ message: 'Article not found' });
            }

            res.status(200).json({ article });
        } catch (error: any) {
            console.error('Error fetching article by ID:', error);
            res.status(500).json({
                message: 'Error fetching article',
                error: error.message,
            });
        }
    },

    // GET latest result for a specific company
    async getLatestForCompany(req: Request, res: Response) {
        try {
            const { company } = req.params;
            const article = await NewsArticle.findOne({
                company: { $regex: company, $options: 'i' },
            }).sort({ crawledAt: -1 });

            if (!article) {
                return res.status(404).json({ message: 'No articles found for this company' });
            }

            res.status(200).json({ article });
        } catch (error: any) {
            console.error('Error fetching latest article for company:', error);
            res.status(500).json({
                message: 'Error fetching latest article',
                error: error.message,
            });
        }
    },
};
