/**
 * Company Name Normalization Utility
 * 
 * Normalizes company names for duplicate detection and fuzzy matching.
 * Removes common suffixes, special characters, and standardizes format.
 */

export function normalizeCompanyName(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  // Step 1: Convert to lowercase and trim
  let normalized = name.toLowerCase().trim();

  // Step 2: Remove common company suffixes/prefixes
  const suffixes = [
    'pvt ltd', 'private limited', 'ltd', 'limited',
    'inc', 'incorporated', 'corp', 'corporation',
    'llc', 'llp', 'plc', 'sa', 'ag', 'gmbh',
    'pvt', 'private', 'co', 'company'
  ];

  suffixes.forEach(suffix => {
    // Match suffix at end of string (with optional punctuation)
    const regex = new RegExp(`\\s+${suffix}(\\.|,|$|\\s)`, 'gi');
    normalized = normalized.replace(regex, ' ').trim();
    
    // Also check if suffix is at the end without space
    if (normalized.endsWith(suffix)) {
      normalized = normalized.slice(0, -suffix.length).trim();
    }
  });

  // Step 3: Remove special characters (keep spaces and alphanumeric)
  normalized = normalized.replace(/[^\w\s]/g, ' ');

  // Step 4: Normalize whitespace (multiple spaces to single space)
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Calculate similarity score between two strings using Levenshtein distance
 * Returns a percentage (0-100)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 100;

  const len1 = str1.length;
  const len2 = str2.length;
  const maxLen = Math.max(len1, len2);
  
  if (maxLen === 0) return 100;

  // Calculate Levenshtein distance
  const distance = levenshteinDistance(str1, str2);
  
  // Convert to similarity percentage
  return ((maxLen - distance) / maxLen) * 100;
}

/**
 * Levenshtein distance algorithm
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  
  // Create DP table
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Initialize base cases
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  // Fill DP table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // deletion
          dp[i][j - 1] + 1,      // insertion
          dp[i - 1][j - 1] + 1   // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Find similar directories based on normalized name and similarity threshold
 */
export interface SimilarDirectory {
  id: string;
  name: string;
  normalizedName: string;
  similarity: number;
  documentCount: number;
  drhpCount: number;
  rhpCount: number;
  lastDocumentUpload?: Date;
}

export async function findSimilarDirectories(
  searchName: string,
  workspaceId: string,
  threshold: number = 80
): Promise<SimilarDirectory[]> {
  const { Directory } = await import('../models/Directory');
  
  const normalized = normalizeCompanyName(searchName);
  
  if (!normalized) {
    return [];
  }

  // Get all directories in the workspace
  const directories = await Directory.find({ 
    workspaceId,
    parentId: null // Only top-level directories (company directories)
  });

  const matches: SimilarDirectory[] = [];

  for (const dir of directories) {
    const dirNormalized = dir.normalizedName || normalizeCompanyName(dir.name);
    
    // Calculate similarity
    const similarity = calculateSimilarity(normalized, dirNormalized);
    
    if (similarity >= threshold) {
      matches.push({
        id: dir.id,
        name: dir.name,
        normalizedName: dirNormalized,
        similarity: Math.round(similarity * 100) / 100, // Round to 2 decimal places
        documentCount: dir.documentCount || 0,
        drhpCount: dir.drhpCount || 0,
        rhpCount: dir.rhpCount || 0,
        lastDocumentUpload: dir.lastDocumentUpload,
      });
    }
  }

  // Sort by similarity (descending)
  return matches.sort((a, b) => b.similarity - a.similarity);
}









