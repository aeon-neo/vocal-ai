import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

/**
 * Web Fetch Tool
 *
 * Fetches and extracts readable content from web pages.
 * Uses Mozilla Readability to extract main article content, removing ads,
 * navigation, footers, and other clutter.
 *
 * IMPORTANT: The extracted content is a CLEANED view of the webpage:
 * - No ads or popups
 * - No navigation menus or sidebars
 * - No comments sections
 * - Only the main article/content
 * - May differ significantly from what user sees in browser
 */

export interface FetchedContent {
  url: string;
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  content: string;
  textContent: string;
  length: number;
  siteName: string | null;
  publishedTime: string | null;
  success: boolean;
  error?: string;
}

/**
 * Fetch and extract readable content from a URL
 */
async function fetchWebPage(url: string): Promise<FetchedContent> {
  try {
    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      return {
        url,
        title: null,
        byline: null,
        excerpt: null,
        content: "",
        textContent: "",
        length: 0,
        siteName: null,
        publishedTime: null,
        success: false,
        error: "Invalid URL format",
      };
    }

    // Fetch HTML
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Niimi/3.0; +https://github.com/yourusername/niimi)",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return {
        url,
        title: null,
        byline: null,
        excerpt: null,
        content: "",
        textContent: "",
        length: 0,
        siteName: null,
        publishedTime: null,
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const html = await response.text();

    // Parse with JSDOM
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // Extract readable content with Readability
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article) {
      return {
        url,
        title: null,
        byline: null,
        excerpt: null,
        content: "",
        textContent: "",
        length: 0,
        siteName: null,
        publishedTime: null,
        success: false,
        error: "Failed to extract readable content from page",
      };
    }

    return {
      url,
      title: article.title || null,
      byline: article.byline || null,
      excerpt: article.excerpt || null,
      content: article.content || "",
      textContent: article.textContent || "",
      length: article.length || 0,
      siteName: article.siteName || null,
      publishedTime: article.publishedTime || null,
      success: true,
    };
  } catch (error) {
    return {
      url,
      title: null,
      byline: null,
      excerpt: null,
      content: "",
      textContent: "",
      length: 0,
      siteName: null,
      publishedTime: null,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Create web fetch tool for LangChain
 */
export function createWebFetchTool() {
  return tool(
    async ({ url }) => {
      const result = await fetchWebPage(url);

      if (!result.success) {
        return JSON.stringify({
          success: false,
          url: result.url,
          error: result.error,
        });
      }

      return JSON.stringify({
        success: true,
        url: result.url,
        title: result.title,
        author: result.byline,
        excerpt: result.excerpt,
        content: result.textContent,
        contentLength: result.length,
        siteName: result.siteName,
        publishedTime: result.publishedTime,
        note: "This is a CLEANED view of the webpage. Ads, navigation, sidebars, comments, and other clutter have been removed. Only the main article content is included. The user's browser view may look significantly different.",
      });
    },
    {
      name: "fetch_web_page",
      description: `Fetch and extract readable content from a web page URL.

**IMPORTANT - Content Cleaning:**
This tool provides a CLEANED, reader-friendly view of web pages using Mozilla Readability:
- ✅ Main article content is extracted
- ❌ Ads, popups, and banners are removed
- ❌ Navigation menus and sidebars are removed
- ❌ Comments sections are removed
- ❌ Footers and related links are removed

The content you receive may be VERY DIFFERENT from what the user sees in their browser.
Always mention this when discussing web content with the user.

**Use Cases:**
- User asks "what does this article say?" or "summarize this page"
- User provides a URL and wants information from it
- User asks to "read" or "check" a website
- User wants to extract information from an article or blog post

**Returns:**
- title: Article/page title
- author: Article author/byline (if available)
- excerpt: Article summary/description
- content: Main text content (cleaned)
- contentLength: Character count
- siteName: Website name
- publishedTime: Publication date (if available)

**Limitations:**
- May not work well with JavaScript-heavy sites (SPAs)
- Cannot access paywalled content
- Cannot see dynamic content loaded after page load
- Cannot see images, videos, or interactive elements
- Best for article/blog content, not web apps`,
      schema: z.object({
        url: z.string().describe("Complete URL to fetch (must include http:// or https://)"),
      }),
    }
  );
}
