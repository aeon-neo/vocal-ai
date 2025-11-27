/**
 * Appearance Service
 *
 * Manages physical appearance tracking, change detection, and identity verification.
 * Analyzes video frames to extract physical description, compares with stored profile,
 * and notifies when changes are detected (haircut, new glasses, etc.).
 *
 * Key Features:
 * - Physical appearance extraction (hair, facial features, clothing, demographics)
 * - Change detection (compares current appearance with stored profile)
 * - Identity verification (determines if it's the same person)
 * - Appearance history timeline
 * - Natural language change descriptions
 */

import { VisionService } from './vision-service';
import { PostgresService } from './storage';
import OpenAI from 'openai';

export interface PhysicalAppearance {
  hair: {
    color: string;
    style: string;
    length: string;
  };
  facialFeatures: {
    facialHair: string | null;
    glasses: boolean;
    glassesType: string | null;
    distinctiveFeatures: string[];
  };
  clothing: {
    upperBody: string;
    accessories: string[];
  };
  demographics: {
    estimatedAgeRange: string;
    genderPresentation: string;
  };
  distinctiveCharacteristics: string[];
  overallDescription: string;
  confidence: number;
}

export interface AppearanceChanges {
  haircut: boolean;
  hairColorChange: boolean;
  facialHairChange: boolean;
  glassesChange: boolean;
  significantChange: boolean;
  changes: string[];
}

export interface AppearanceAnalysisResult {
  appearance: PhysicalAppearance;
  changes: AppearanceChanges | null;
  changeSummary: string | null;
  identityMatchConfidence: number;
  shouldUpdate: boolean;
}

export class AppearanceService {
  private visionService: VisionService;
  private storageService: PostgresService;
  private openai: OpenAI;

  constructor(
    visionService: VisionService,
    storageService: PostgresService,
    openaiApiKey?: string
  ) {
    this.visionService = visionService;
    this.storageService = storageService;
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY
    });
  }

  /**
   * Analyze appearance from video frame and compare with stored profile
   */
  async analyzeAndCompare(
    frameBase64: string,
    sessionId?: string
  ): Promise<AppearanceAnalysisResult> {
    // Extract appearance from video frame
    const currentAppearance = await this.visionService.analyzeAppearance(frameBase64);

    console.log('[AppearanceService] Analyzed appearance:', currentAppearance.overallDescription);

    // Get stored appearance from user_profile
    const storedAppearance = await this.getStoredAppearance();

    // If no stored appearance, this is the first time
    if (!storedAppearance) {
      console.log('[AppearanceService] No stored appearance - first observation');
      await this.storeInitialAppearance(currentAppearance, sessionId);
      return {
        appearance: currentAppearance,
        changes: null,
        changeSummary: null,
        identityMatchConfidence: 1.0,
        shouldUpdate: true
      };
    }

    // Compare appearances and detect changes
    const changes = await this.detectChanges(storedAppearance, currentAppearance);
    const identityMatchConfidence = await this.verifyIdentity(storedAppearance, currentAppearance);

    // Generate natural language summary of changes
    const changeSummary = changes.changes.length > 0
      ? await this.generateChangeSummary(changes, storedAppearance, currentAppearance)
      : null;

    // Store in appearance_history
    await this.storeAppearanceHistory(
      currentAppearance,
      changes.changes.length > 0 ? changes : null,
      changeSummary,
      identityMatchConfidence,
      sessionId
    );

    // Update user_profile if confidence is high and changes are significant
    const shouldUpdate = identityMatchConfidence > 0.7 && changes.significantChange;

    if (shouldUpdate) {
      await this.updateStoredAppearance(currentAppearance);
      console.log('[AppearanceService] Updated stored appearance with new data');
    }

    return {
      appearance: currentAppearance,
      changes: changes.changes.length > 0 ? changes : null,
      changeSummary,
      identityMatchConfidence,
      shouldUpdate
    };
  }

  /**
   * Get stored appearance from user_profile
   */
  private async getStoredAppearance(): Promise<PhysicalAppearance | null> {
    const result = await this.storageService.query(
      'SELECT physical_appearance FROM user_profile LIMIT 1'
    );

    if (result.rows.length === 0 || !result.rows[0].physical_appearance) {
      return null;
    }

    return result.rows[0].physical_appearance as PhysicalAppearance;
  }

  /**
   * Store initial appearance (first observation)
   */
  private async storeInitialAppearance(
    appearance: PhysicalAppearance,
    sessionId?: string
  ): Promise<void> {
    // Update user_profile
    await this.storageService.query(
      `UPDATE user_profile
       SET physical_appearance = $1,
           last_appearance_check = NOW()`,
      [JSON.stringify(appearance)]
    );

    // Store in history
    await this.storageService.query(
      `INSERT INTO appearance_history
       (appearance_data, changes_detected, change_summary, identity_match_confidence, session_id)
       VALUES ($1, NULL, 'Initial appearance observation', 1.0, $2)`,
      [JSON.stringify(appearance), sessionId || null]
    );
  }

  /**
   * Update stored appearance in user_profile
   */
  private async updateStoredAppearance(appearance: PhysicalAppearance): Promise<void> {
    await this.storageService.query(
      `UPDATE user_profile
       SET physical_appearance = $1,
           last_appearance_check = NOW()`,
      [JSON.stringify(appearance)]
    );
  }

  /**
   * Store appearance observation in history
   */
  private async storeAppearanceHistory(
    appearance: PhysicalAppearance,
    changes: AppearanceChanges | null,
    changeSummary: string | null,
    identityMatchConfidence: number,
    sessionId?: string
  ): Promise<void> {
    await this.storageService.query(
      `INSERT INTO appearance_history
       (appearance_data, changes_detected, change_summary, identity_match_confidence, session_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        JSON.stringify(appearance),
        changes ? JSON.stringify(changes) : null,
        changeSummary,
        identityMatchConfidence,
        sessionId || null
      ]
    );
  }

  /**
   * Detect changes between stored and current appearance
   */
  private async detectChanges(
    stored: PhysicalAppearance,
    current: PhysicalAppearance
  ): Promise<AppearanceChanges> {
    const changes: string[] = [];
    let haircut = false;
    let hairColorChange = false;
    let facialHairChange = false;
    let glassesChange = false;

    // Hair changes
    if (stored.hair.length !== current.hair.length) {
      haircut = true;
      changes.push(`hair_length_change: ${stored.hair.length} -> ${current.hair.length}`);
    }
    if (stored.hair.color !== current.hair.color) {
      hairColorChange = true;
      changes.push(`hair_color_change: ${stored.hair.color} -> ${current.hair.color}`);
    }
    if (stored.hair.style !== current.hair.style) {
      changes.push(`hair_style_change: ${stored.hair.style} -> ${current.hair.style}`);
    }

    // Facial hair changes
    if (stored.facialFeatures.facialHair !== current.facialFeatures.facialHair) {
      facialHairChange = true;
      changes.push(`facial_hair_change: ${stored.facialFeatures.facialHair || 'none'} -> ${current.facialFeatures.facialHair || 'none'}`);
    }

    // Glasses changes
    if (stored.facialFeatures.glasses !== current.facialFeatures.glasses) {
      glassesChange = true;
      const storedState = stored.facialFeatures.glasses ? (stored.facialFeatures.glassesType || 'glasses') : 'no glasses';
      const currentState = current.facialFeatures.glasses ? (current.facialFeatures.glassesType || 'glasses') : 'no glasses';
      changes.push(`glasses_change: ${storedState} -> ${currentState}`);
    } else if (stored.facialFeatures.glasses && current.facialFeatures.glasses &&
               stored.facialFeatures.glassesType !== current.facialFeatures.glassesType) {
      glassesChange = true;
      changes.push(`glasses_type_change: ${stored.facialFeatures.glassesType} -> ${current.facialFeatures.glassesType}`);
    }

    // Significant change = haircut, hair color change, facial hair change, or glasses change
    const significantChange = haircut || hairColorChange || facialHairChange || glassesChange;

    return {
      haircut,
      hairColorChange,
      facialHairChange,
      glassesChange,
      significantChange,
      changes
    };
  }

  /**
   * Verify identity - determine if current appearance matches stored appearance
   * Returns confidence score 0-1
   */
  private async verifyIdentity(
    stored: PhysicalAppearance,
    current: PhysicalAppearance
  ): Promise<number> {
    // Use Claude to assess identity match based on appearance comparison
    const prompt = `Compare these two physical appearance descriptions and determine if they describe the same person.

Stored appearance:
${JSON.stringify(stored, null, 2)}

Current appearance:
${JSON.stringify(current, null, 2)}

Consider:
- Demographics (age range, gender presentation) should match closely
- Distinctive characteristics should be consistent
- Temporary changes (haircut, glasses, clothing) don't affect identity
- Permanent features (facial structure, build) should align

Return ONLY a JSON object:
{
  "is_same_person": true or false,
  "confidence": 0.0 to 1.0,
  "reasoning": "brief explanation"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 500,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = response.choices[0]?.message?.content || '{}';

      // Parse JSON response
      let jsonContent = content.trim();
      if (jsonContent.includes('```')) {
        const jsonMatch = jsonContent.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
        if (jsonMatch) {
          jsonContent = jsonMatch[1].trim();
        }
      }
      if (!jsonContent.startsWith('{')) {
        const objectMatch = jsonContent.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          jsonContent = objectMatch[0];
        }
      }

      const result = JSON.parse(jsonContent);
      console.log('[AppearanceService] Identity verification:', result.reasoning);

      return result.confidence;
    } catch (error) {
      console.error('[AppearanceService] Identity verification failed:', error);
      // Conservative fallback - assume it's the same person with medium confidence
      return 0.7;
    }
  }

  /**
   * Generate natural language summary of changes
   */
  private async generateChangeSummary(
    changes: AppearanceChanges,
    stored: PhysicalAppearance,
    current: PhysicalAppearance
  ): Promise<string> {
    const prompt = `Generate a natural, friendly sentence describing the appearance changes detected.

Changes detected:
${JSON.stringify(changes, null, 2)}

Previous appearance:
${stored.overallDescription}

Current appearance:
${current.overallDescription}

Generate a natural sentence like:
- "I notice you got a haircut!"
- "You're wearing glasses today"
- "I see you grew a beard"
- "You changed your hairstyle and you're wearing new glasses"

Return ONLY the sentence (no quotes, no JSON, just the text).`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 100,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = response.choices[0]?.message?.content?.trim() || '';
      return content;
    } catch (error) {
      console.error('[AppearanceService] Change summary generation failed:', error);
      // Fallback to simple description
      return `I notice some changes in your appearance: ${changes.changes.join(', ')}`;
    }
  }

  /**
   * Get recent appearance changes from history
   */
  async getRecentChanges(limit: number = 10): Promise<any[]> {
    const result = await this.storageService.query(
      `SELECT appearance_data, changes_detected, change_summary, identity_match_confidence, observed_at
       FROM appearance_history
       WHERE changes_detected IS NOT NULL
       ORDER BY observed_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  }

  /**
   * Get current stored appearance description
   */
  async getCurrentAppearanceDescription(): Promise<string | null> {
    const appearance = await this.getStoredAppearance();
    return appearance ? appearance.overallDescription : null;
  }
}
