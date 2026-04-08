import { Request, Response, NextFunction } from "express";

/**
 * Tenant Isolation Middleware
 *
 * This middleware ensures that req.tenantId is ALWAYS set on authenticated
 * requests and provides a helper method (req.tenantQuery) that returns
 * the MongoDB filter fragment { tenant_id: X } for use in queries.
 *
 * This is the MongoDB equivalent of PostgreSQL Row-Level Security:
 * instead of the DB enforcing isolation, this middleware + helper
 * ensures every query is scoped to the correct tenant.
 *
 * USAGE in controllers:
 *   const docs = await Job.find({ ...req.tenantQuery(), status: "completed" });
 *   const doc  = await Job.findOne({ ...req.tenantQuery(), id: req.params.id });
 */

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      tenantQuery: () => { tenant_id: string };
    }
  }
}

export function tenantIsolation(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // tenantId comes from the authenticated user's domainId
  // (set by auth.ts + domainAuth.ts middleware)
  const user = (req as any).user;
  const userDomain = (req as any).userDomain;

  // For internal Python→Node calls, tenantId comes from the request body
  if ((req as any).__internalCall && req.body?.tenant_id) {
    req.tenantId = req.body.tenant_id;
    req.tenantQuery = () => ({ tenant_id: req.tenantId! });
    return next();
  }

  if (!user) {
    return res.status(401).json({
      error: "Authentication required for tenant isolation",
      code: "AUTH_REQUIRED",
    });
  }

  // User's domainId is the tenant identifier
  const tenantId = user.domainId || userDomain;

  if (!tenantId) {
    return res.status(400).json({
      error: "Tenant context could not be resolved. User has no domain.",
      code: "NO_TENANT",
    });
  }

  req.tenantId = tenantId;

  // Helper function to generate tenant-scoped query fragment.
  // Use this in EVERY MongoDB query on tenant-scoped collections.
  req.tenantQuery = () => ({ tenant_id: tenantId });

  next();
}

/**
 * INTERNAL_SECRET validation for Python→Node callback endpoints.
 *
 * Python backend must send this header with every request to Node's
 * internal callback endpoints (status updates, result submissions).
 * This prevents external callers from updating job statuses.
 *
 * Header: X-Internal-Secret: <value from INTERNAL_SECRET env var>
 */
export function requireInternalSecret(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const expected = process.env["INTERNAL-SECRET"];

  if (!expected) {
    console.error(
      "FATAL: INTERNAL_SECRET env var not set. Internal endpoints are disabled."
    );
    return res.status(503).json({
      error: "Internal endpoints not configured",
      code: "INTERNAL_SECRET_MISSING",
    });
  }

  const provided = req.headers["x-internal-secret"] as string;

  if (!provided || provided !== expected) {
    return res.status(403).json({
      error: "Invalid or missing internal secret",
      code: "INVALID_INTERNAL_SECRET",
    });
  }

  // Mark as internal call so tenantIsolation can extract tenantId from body
  (req as any).__internalCall = true;

  next();
}
