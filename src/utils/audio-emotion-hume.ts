/**
 * Audio Emotion Analysis using Hume AI
 * Professional emotion detection from voice using trained models
 * Supports local files via batch API
 */

import { HumeClient } from 'hume';
import * as fs from 'fs';

interface HumeEmotionScore {
  name: string;
  score: number;
}

export interface AudioEmotionResult {
  primary: string;
  confidence: number;
  all: {
    angry: number;
    calm: number;
    happy: number;
    sad: number;
    fearful: number;
    neutral: number;
  };
}

/**
 * Map Hume's emotions to our basic categories
 */
function mapHumeToBasicEmotions(humeEmotions: HumeEmotionScore[]): AudioEmotionResult['all'] {
  const emotionMap = new Map(humeEmotions.map(e => [e.name.toLowerCase(), e.score]));

  return {
    happy: Math.max(
      emotionMap.get('joy') || 0,
      emotionMap.get('amusement') || 0,
      emotionMap.get('excitement') || 0,
      emotionMap.get('contentment') || 0
    ),
    sad: Math.max(
      emotionMap.get('sadness') || 0,
      emotionMap.get('disappointment') || 0,
      emotionMap.get('grief') || 0
    ),
    angry: Math.max(
      emotionMap.get('anger') || 0,
      emotionMap.get('annoyance') || 0,
      emotionMap.get('rage') || 0
    ),
    fearful: Math.max(
      emotionMap.get('fear') || 0,
      emotionMap.get('anxiety') || 0,
      emotionMap.get('terror') || 0,
      emotionMap.get('nervousness') || 0
    ),
    calm: Math.max(
      emotionMap.get('calmness') || 0,
      emotionMap.get('serenity') || 0,
      emotionMap.get('peacefulness') || 0,
      emotionMap.get('relaxation') || 0
    ),
    neutral: Math.max(
      emotionMap.get('neutral') || 0,
      emotionMap.get('concentration') || 0
    )
  };
}

/**
 * Analyze local audio file using Hume AI batch API
 */
export async function analyzeAudioEmotions(audioPath: string): Promise<AudioEmotionResult> {
  const apiKey = process.env.HUME_API_KEY;

  if (!apiKey) {
    throw new Error('HUME_API_KEY must be set in .env');
  }

  try {
    console.log('[Hume] Initializing client with API key...');
    const client = new HumeClient({ apiKey });

    console.log('[Hume] Starting batch inference job with local file...');

    // Open file stream for Hume API
    const fileStream = fs.createReadStream(audioPath);

    // Start batch inference job with local file
    const job = await client.expressionMeasurement.batch.startInferenceJobFromLocalFile({
      file: [fileStream],
      json: { models: { prosody: {} } }
    });

    console.log(`[Hume] Job started: ${job.jobId}`);

    // Poll for completion
    let attempts = 0;
    while (attempts < 60) {
      const status = await client.expressionMeasurement.batch.getJobDetails(job.jobId);

      if (status.state.status === 'COMPLETED') {
        console.log('[Hume] Job completed');
        break;
      } else if (status.state.status === 'FAILED') {
        throw new Error(`Hume job failed: ${status.state.message}`);
      }

      console.log(`[Hume] Status: ${status.state.status} (${attempts + 1}/60)`);
      await new Promise(r => setTimeout(r, 1000));
      attempts++;
    }

    if (attempts >= 60) {
      throw new Error('Hume job timed out');
    }

    // Get predictions
    console.log('[Hume] Fetching predictions...');
    const predictions = await client.expressionMeasurement.batch.getJobPredictions(job.jobId);

    const prosody = predictions[0]?.results?.predictions?.[0]?.models?.prosody;
    if (!prosody) {
      throw new Error('No prosody predictions in response');
    }

    const grouped = prosody.groupedPredictions || (prosody as any).grouped_predictions;
    const emotions = grouped?.[0]?.predictions?.[0]?.emotions;

    if (!emotions) {
      throw new Error('No emotions found in predictions');
    }

    console.log(`[Hume] Detected ${emotions.length} emotions`);

    const basicEmotions = mapHumeToBasicEmotions(emotions);
    const entries = Object.entries(basicEmotions) as [string, number][];
    const [primary, confidence] = entries.reduce(
      (max, e) => e[1] > max[1] ? e : max,
      ['neutral', 0]
    );

    console.log(`[Hume] Primary: ${primary} (${(confidence * 100).toFixed(1)}%)`);

    return { primary, confidence, all: basicEmotions };

  } catch (error) {
    console.error('[Hume] Error:', error);
    throw error;
  }
}
