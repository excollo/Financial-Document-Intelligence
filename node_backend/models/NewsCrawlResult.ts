import mongoose, { Schema, Document } from 'mongoose';

export interface INewsCrawlResult extends Document {
    company: string;
    analysisDate: Date;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    sentimentSummary: {
        positiveArticles: number;
        negativeArticles: number;
        neutralArticles: number;
    };
    criticalFindings: Array<{
        category: string;
        finding: string;
        source: string;
        date: string;
        severity?: string;
    }>;
    positiveHighlights: Array<{
        category: string;
        finding: string;
        source: string;
        date: string;
    }>;
    recommendations: string[];
    nextReviewDate: Date;
    workspaceId: string;
    domainId: string;
    createdAt: Date;
    updatedAt: Date;
}

const NewsCrawlResultSchema: Schema = new Schema(
    {
        company: {
            type: String,
            required: true, 
            index: true,
        },
        analysisDate: {
            type: Date,
            required: true,
            index: true,
        },
        riskLevel: {
            type: String,
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            required: true,
            index: true,
        },
        sentimentSummary: {
            positiveArticles: { type: Number, default: 0 },
            negativeArticles: { type: Number, default: 0 },
            neutralArticles: { type: Number, default: 0 },
        },
        criticalFindings: [
            {
                category: { type: String, required: true },
                finding: { type: String, required: true },
                source: { type: String, required: true },
                date: { type: String, required: true },
                severity: { type: String },
            },
        ],
        positiveHighlights: [
            {
                category: { type: String, required: true },
                finding: { type: String, required: true },
                source: { type: String, required: true },
                date: { type: String, required: true },
            },
        ],
        recommendations: [{ type: String }],
        nextReviewDate: {
            type: Date,
            required: true,
        },
        workspaceId: {
            type: String,
            required: true,
            index: true,
        },
        domainId: {
            type: String,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index for efficient querying
NewsCrawlResultSchema.index({ workspaceId: 1, company: 1, analysisDate: -1 });
NewsCrawlResultSchema.index({ workspaceId: 1, riskLevel: 1 });

export default mongoose.model<INewsCrawlResult>('NewsCrawlResult', NewsCrawlResultSchema);
