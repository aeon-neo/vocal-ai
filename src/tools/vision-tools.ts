import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { VisionService } from "../vision-service";
import { ImageExtractor } from "../utils/image-extractor";
import { VideoExtractor } from "../utils/video-extractor";
import { FileValidator } from "../utils/file-validator";
import { getBestMatch, resolvePath, getDocumentDirectory } from "../utils/filename-matcher";
import { PostgresService } from "../storage";
import { MotorAgent } from "../agents/motor";

/**
 * Vision Tools
 *
 * Tools for analyzing images and videos using Claude's vision capabilities.
 */

/**
 * Analyze Image Tool
 *
 * Analyzes an image file from ~/niimi-documents/ using Claude Vision.
 * Supports common image formats: JPEG, PNG, GIF, WebP, BMP.
 */
export function createAnalyzeImageTool(visionService: VisionService) {
  return tool(
    async ({ fileName, query }) => {
      try {
        // Try to resolve filename
        let filePath = resolvePath(fileName);

        // If direct resolution fails, try fuzzy matching
        if (!filePath) {
          const matches = getBestMatch(fileName);

          if (matches.length === 0) {
            return JSON.stringify({
              success: false,
              error: "No matching images found",
              suggestion: `Try listing documents with 'list documents' or place your image in ${getDocumentDirectory()}`
            });
          }

          if (matches.length > 1) {
            return JSON.stringify({
              success: false,
              error: "Multiple matching files found",
              matches: matches.map(m => ({
                fileName: m.fileName,
                score: m.score
              })),
              suggestion: "Please specify which image you want to analyze"
            });
          }

          filePath = matches[0].fullPath;
          fileName = matches[0].fileName;
        }

        // Validate image file
        const validation = FileValidator.validateImage(filePath);
        if (!validation.valid) {
          return JSON.stringify({
            success: false,
            error: validation.error
          });
        }

        // Extract image data
        const imageExtractor = new ImageExtractor();
        const extractResult = await imageExtractor.extractImage(filePath);

        if (!extractResult.success || !extractResult.image) {
          return JSON.stringify({
            success: false,
            error: extractResult.error || "Failed to extract image data"
          });
        }

        // Analyze image
        const analysisResult = await visionService.analyzeImage(
          extractResult.image,
          query
        );

        if (!analysisResult.success) {
          return JSON.stringify({
            success: false,
            error: analysisResult.error
          });
        }

        return JSON.stringify({
          success: true,
          fileName: fileName,
          analysis: analysisResult.analysis,
          metadata: {
            format: extractResult.image.format,
            size: FileValidator.formatFileSize(extractResult.image.size),
            dimensions: extractResult.image.width && extractResult.image.height
              ? `${extractResult.image.width}x${extractResult.image.height}`
              : undefined,
            ...analysisResult.metadata
          }
        });

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: "Failed to analyze image",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    },
    {
      name: "analyze_image",
      description: `Analyze an image file from ~/niimi-documents/ using Claude Vision.

Supported formats: JPEG, PNG, GIF, WebP, BMP

This tool provides immediate image analysis (synchronous, no ingestion into knowledge base).

Use this when user:
- Says "analyze this image" or "what's in this image?"
- Asks questions about a specific image
- Wants to understand image content
- Needs OCR (text extraction from image)
- Wants to identify objects, people, or scenes in an image

Supports subdirectory paths and fuzzy filename matching:
- Exact with path: "screenshots/screenshot.png"
- Partial filename: "screenshot" - matches any supported format in subdirectories
- Multiple words: All words must appear in filename
- Recursive search: Finds files in any subdirectory

Examples:
- "What's in niimi.PNG?" - Analyzes the image and describes contents
- "Analyze the diagram" - Finds and analyzes diagram image
- "Extract text from the screenshot" - OCR on screenshot
- "What objects are in the photo?" - Object detection in photo`,
      schema: z.object({
        fileName: z.string().describe("Filename or partial match (e.g., 'screenshot' or 'images/photo.png')"),
        query: z.string().optional().describe("Optional: Specific question or instruction about the image (e.g., 'What text is visible?', 'Describe the main objects')")
      })
    }
  );
}

/**
 * Analyze Video Tool
 *
 * Analyzes a video file by extracting frames and analyzing them with Claude Vision.
 * This is an async operation handled by Motor agent due to processing time.
 */
export function createAnalyzeVideoTool(
  storageService: PostgresService,
  motorAgent: MotorAgent
) {
  return tool(
    async ({ fileName, query, maxFrames }) => {
      try {
        // Try to resolve filename
        let filePath = resolvePath(fileName);

        // If direct resolution fails, try fuzzy matching
        if (!filePath) {
          const matches = getBestMatch(fileName);

          if (matches.length === 0) {
            return JSON.stringify({
              success: false,
              error: "No matching videos found",
              suggestion: `Try listing documents with 'list documents' or place your video in ${getDocumentDirectory()}`
            });
          }

          if (matches.length > 1) {
            return JSON.stringify({
              success: false,
              error: "Multiple matching files found",
              matches: matches.map(m => ({
                fileName: m.fileName,
                score: m.score
              })),
              suggestion: "Please specify which video you want to analyze"
            });
          }

          filePath = matches[0].fullPath;
          fileName = matches[0].fileName;
        }

        // Validate video file
        const validation = FileValidator.validateVideo(filePath);
        if (!validation.valid) {
          return JSON.stringify({
            success: false,
            error: validation.error
          });
        }

        // Queue video analysis with Motor agent
        const result = await storageService.query(
          `INSERT INTO action_queue (action_type, payload, priority, status, started_at)
           VALUES ($1, $2, $3, 'pending', NOW())
           RETURNING id, action_type, status, created_at`,
          [
            "analyze_video",
            JSON.stringify({
              fileName,
              filePath,
              query: query || null,
              maxFrames: maxFrames || 10
            }),
            5 // Medium-high priority
          ]
        );

        const queuedAction = result.rows[0];

        // Trigger Motor agent to start processing
        motorAgent.processActionQueue().catch(error => {
          console.error("[Vision Tool] Motor agent processing error:", error);
        });

        return JSON.stringify({
          success: true,
          actionId: queuedAction.id,
          fileName: fileName,
          fileSize: validation.size ? FileValidator.formatFileSize(validation.size) : undefined,
          status: "processing",
          estimatedTime: "2-5 minutes (depending on video length)",
          message: `I'm analyzing ${fileName}. You'll receive a notification when it's ready.`
        });

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: "Failed to queue video analysis",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    },
    {
      name: "analyze_video",
      description: `Analyze a video file from ~/niimi-documents/ using Claude Vision.

Supported formats: MP4, MOV, AVI, MKV, WebM

This tool analyzes videos asynchronously (2-5 minutes depending on length):
1. Extract frames from video at regular intervals
2. Analyze frames using Claude Vision
3. Generate comprehensive video analysis
4. Notify user when ready

Requires ffmpeg to be installed on the system.

Use this when user:
- Says "analyze this video" or "what's in this video?"
- Asks questions about video content
- Wants to understand what happens in a video
- Needs to identify scenes, actions, or objects in video
- Wants video summary or description

Supports subdirectory paths and fuzzy filename matching:
- Exact with path: "videos/presentation.mp4"
- Partial filename: "presentation" - matches any supported video format
- Multiple words: All words must appear in filename
- Recursive search: Finds files in any subdirectory

Examples:
- "What happens in the demo video?" - Analyzes video and describes content
- "Analyze the presentation" - Finds and analyzes presentation video
- "Summarize the tutorial video" - Generates video summary`,
      schema: z.object({
        fileName: z.string().describe("Filename or partial match (e.g., 'demo' or 'videos/presentation.mp4')"),
        query: z.string().optional().describe("Optional: Specific question about the video (e.g., 'What products are shown?', 'Describe the main events')"),
        maxFrames: z.number().optional().describe("Maximum number of frames to extract (default: 10, max: 20)")
      })
    }
  );
}

/**
 * Compare Images Tool
 *
 * Compares two images and describes similarities/differences.
 */
export function createCompareImagesTool(visionService: VisionService) {
  return tool(
    async ({ fileName1, fileName2, query }) => {
      try {
        // Resolve first image
        let filePath1 = resolvePath(fileName1);
        if (!filePath1) {
          const matches = getBestMatch(fileName1);
          if (matches.length !== 1) {
            return JSON.stringify({
              success: false,
              error: `Could not resolve first image: ${fileName1}`
            });
          }
          filePath1 = matches[0].fullPath;
          fileName1 = matches[0].fileName;
        }

        // Resolve second image
        let filePath2 = resolvePath(fileName2);
        if (!filePath2) {
          const matches = getBestMatch(fileName2);
          if (matches.length !== 1) {
            return JSON.stringify({
              success: false,
              error: `Could not resolve second image: ${fileName2}`
            });
          }
          filePath2 = matches[0].fullPath;
          fileName2 = matches[0].fileName;
        }

        // Validate both images
        const validation1 = FileValidator.validateImage(filePath1);
        const validation2 = FileValidator.validateImage(filePath2);

        if (!validation1.valid || !validation2.valid) {
          return JSON.stringify({
            success: false,
            error: validation1.error || validation2.error
          });
        }

        // Extract both images
        const imageExtractor = new ImageExtractor();
        const extract1 = await imageExtractor.extractImage(filePath1);
        const extract2 = await imageExtractor.extractImage(filePath2);

        if (!extract1.success || !extract1.image || !extract2.success || !extract2.image) {
          return JSON.stringify({
            success: false,
            error: "Failed to extract image data"
          });
        }

        // Compare images
        const comparisonResult = await visionService.compareImages(
          extract1.image,
          extract2.image,
          query
        );

        if (!comparisonResult.success) {
          return JSON.stringify({
            success: false,
            error: comparisonResult.error
          });
        }

        return JSON.stringify({
          success: true,
          image1: fileName1,
          image2: fileName2,
          comparison: comparisonResult.analysis,
          metadata: comparisonResult.metadata
        });

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: "Failed to compare images",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    },
    {
      name: "compare_images",
      description: `Compare two images and describe their similarities and differences.

Use this when user wants to:
- Compare two images side-by-side
- Identify differences between versions
- Analyze changes between before/after images
- Compare similar objects or scenes

Examples:
- "Compare screenshot1.png and screenshot2.png"
- "What's different between the old and new logo?"
- "Compare before.jpg and after.jpg"`,
      schema: z.object({
        fileName1: z.string().describe("First image filename or partial match"),
        fileName2: z.string().describe("Second image filename or partial match"),
        query: z.string().optional().describe("Optional: Specific comparison question")
      })
    }
  );
}

/**
 * Extract Text from Image Tool (OCR)
 *
 * Extracts all visible text from an image.
 */
export function createExtractTextTool(visionService: VisionService) {
  return tool(
    async ({ fileName }) => {
      try {
        // Try to resolve filename
        let filePath = resolvePath(fileName);

        if (!filePath) {
          const matches = getBestMatch(fileName);
          if (matches.length !== 1) {
            return JSON.stringify({
              success: false,
              error: `Could not resolve image: ${fileName}`
            });
          }
          filePath = matches[0].fullPath;
          fileName = matches[0].fileName;
        }

        // Validate image
        const validation = FileValidator.validateImage(filePath);
        if (!validation.valid) {
          return JSON.stringify({
            success: false,
            error: validation.error
          });
        }

        // Extract image
        const imageExtractor = new ImageExtractor();
        const extractResult = await imageExtractor.extractImage(filePath);

        if (!extractResult.success || !extractResult.image) {
          return JSON.stringify({
            success: false,
            error: "Failed to extract image"
          });
        }

        // Extract text using OCR
        const ocrResult = await visionService.extractTextFromImage(extractResult.image);

        if (!ocrResult.success) {
          return JSON.stringify({
            success: false,
            error: ocrResult.error
          });
        }

        return JSON.stringify({
          success: true,
          fileName: fileName,
          extractedText: ocrResult.analysis,
          metadata: ocrResult.metadata
        });

      } catch (error) {
        return JSON.stringify({
          success: false,
          error: "Failed to extract text",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    },
    {
      name: "extract_text_from_image",
      description: `Extract all visible text from an image (OCR).

Use this when user wants to:
- Read text from screenshots
- Extract text from photos of documents
- Get text from images with writing
- Transcribe handwritten notes (if legible)
- Extract text from diagrams or infographics

Examples:
- "Extract text from screenshot.png"
- "What does the sign say in the photo?"
- "Read the text from this image"`,
      schema: z.object({
        fileName: z.string().describe("Image filename or partial match")
      })
    }
  );
}
