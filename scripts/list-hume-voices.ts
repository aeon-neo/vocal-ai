import * as dotenv from 'dotenv';

dotenv.config();

async function listHumeVoices() {
  const apiKey = process.env.HUME_API_KEY;

  if (!apiKey) {
    console.error('HUME_API_KEY not found in .env');
    process.exit(1);
  }

  try {
    console.log('Fetching Hume AI voices via REST API...\n');

    // Use REST API to list HUME_AI provider voices
    const response = await fetch('https://api.hume.ai/v0/tts/voices?provider=HUME_AI&page_size=100', {
      method: 'GET',
      headers: {
        'X-Hume-Api-Key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    console.log('Available Hume TTS Voices:');
    console.log('='.repeat(80));

    if (data.voices && Array.isArray(data.voices)) {
      data.voices.forEach((voice: any, index: number) => {
        console.log(`\n${index + 1}. Name: ${voice.name}`);
        if (voice.id) console.log(`   ID: ${voice.id}`);
        if (voice.provider) console.log(`   Provider: ${voice.provider}`);
        if (voice.description) console.log(`   Description: ${voice.description}`);
        if (voice.compatible_octave_models) {
          console.log(`   Compatible Models: ${voice.compatible_octave_models.join(', ')}`);
        }
      });

      console.log('\n' + '='.repeat(80));
      console.log(`Total voices: ${data.voices.length}`);
    } else {
      console.log('Response data:', JSON.stringify(data, null, 2));
    }

  } catch (error: any) {
    console.error('Error fetching voices:', error.message);
  }
}

listHumeVoices();
