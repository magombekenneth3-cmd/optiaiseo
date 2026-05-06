// src/types/planner.ts

export interface RedditPost {
  id: string;
  subreddit: string;
  type: "comment" | "post" | "link_drop";
  note: string;
  date: string;      // ISO date
  upvotes?: number;
  url?: string;
}

export interface BacklinkTarget {
  id: string;
  domain: string;
  type: "guest_post" | "resource_page" | "broken_link" | "quora" | "medium" | "podcast" | "haro" | "other";
  tier: 1 | 2 | 3;
  status: "Idea" | "Outreach Sent" | "Following Up" | "Won" | "Rejected";
  contactedAt?: string;   // ISO date
  note?: string;
  url?: string;
}

export interface PageScoreChecks {
  // Technical
  pageSpeed: boolean;
  mobileFriendly: boolean;
  httpsEnabled: boolean;
  inSitemap: boolean;
  nobrokenLinks: boolean;
  // On-page
  titleHasKeyword: boolean;
  metaDescription: boolean;
  h1HasKeyword: boolean;
  cleanSlug: boolean;
  keywordInOpening: boolean;
  altTextOnImages: boolean;
  schemaMarkup: boolean;
  // Content quality
  longerThanCompetitors: boolean;
  originalInsight: boolean;
  updatedDateShown: boolean;
  authorBio: boolean;
  outboundLinks: boolean;
}
