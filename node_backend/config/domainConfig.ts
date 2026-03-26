// Domain Configuration for User Management
// Change this when handing over to different clients

export const DOMAIN_CONFIG = {
  // Allowed email domains for user registration
  ALLOWED_DOMAINS: [], // Allow all domains

  // Special allowed emails from other domains (exceptions)
  ALLOWED_SPECIAL_EMAILS: [
    "test@gmail.com", // Special exception user
  ],

  // Default role for new users (first user becomes admin automatically)
  DEFAULT_USER_ROLE: "user" as const,

  // Whether to allow multiple domains or restrict to single domain
  ALLOW_MULTIPLE_DOMAINS: true,

  // Custom domain validation rules
  VALIDATION: {
    // Minimum email length
    MIN_EMAIL_LENGTH: 5,
    // Maximum email length
    MAX_EMAIL_LENGTH: 254,
    // Whether to allow subdomains (e.g., user.subdomain.excollo.com)
    ALLOW_SUBDOMAINS: true,
  },
};

// Helper function to check if email domain is allowed
export function isEmailDomainAllowed(email: string): boolean {
  if (!email || typeof email !== "string") return false;

  // Check if this is a special allowed email (exception)
  if (DOMAIN_CONFIG.ALLOWED_SPECIAL_EMAILS.includes(email.toLowerCase())) {
    return true;
  }

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  // Allow all domains
  return true;
}

// Helper function to get the primary domain from email
export function getPrimaryDomain(email: string): string | null {
  if (!email || typeof email !== "string") return null;

  // Check if this is a special allowed email (exception)
  if (DOMAIN_CONFIG.ALLOWED_SPECIAL_EMAILS.includes(email.toLowerCase())) {
    // For special emails, use a special domain identifier
    return "special";
  }

  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  // Return the raw domain (allow all domains)
  return domain;
}

// Helper function to validate email format and domain
export function validateEmail(email: string): {
  isValid: boolean;
  error?: string;
} {
  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { isValid: false, error: "Invalid email format" };
  }

  // Check email length
  if (email.length < DOMAIN_CONFIG.VALIDATION.MIN_EMAIL_LENGTH) {
    return {
      isValid: false,
      error: `Email must be at least ${DOMAIN_CONFIG.VALIDATION.MIN_EMAIL_LENGTH} characters`,
    };
  }

  if (email.length > DOMAIN_CONFIG.VALIDATION.MAX_EMAIL_LENGTH) {
    return {
      isValid: false,
      error: `Email must be no more than ${DOMAIN_CONFIG.VALIDATION.MAX_EMAIL_LENGTH} characters`,
    };
  }

  return { isValid: true };
}
