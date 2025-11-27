#!/usr/bin/env python3
"""
Audio Emotion Analyzer
Uses wav2vec2-lg-xlsr-en-speech-emotion-recognition model for emotion detection from audio.
Analyzes voice characteristics (tone, pitch, prosody) to detect emotions.
"""

import sys
import json
import warnings

# Suppress transformer warnings
warnings.filterwarnings("ignore", category=UserWarning)
import os
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'  # Suppress TensorFlow warnings

import torch
import torchaudio
import librosa
from transformers import Wav2Vec2ForSequenceClassification, Wav2Vec2FeatureExtractor

# Model configuration
MODEL_NAME = "ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition"

# Expected emotions from the model (8 emotions)
EMOTIONS = ["angry", "calm", "disgust", "fearful", "happy", "neutral", "sad", "surprised"]

def load_model():
    """Load the wav2vec2 emotion recognition model and feature extractor."""
    try:
        import os
        cache_dir = os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "transformers")

        feature_extractor = Wav2Vec2FeatureExtractor.from_pretrained(
            MODEL_NAME,
            cache_dir=cache_dir,
            local_files_only=False
        )
        model = Wav2Vec2ForSequenceClassification.from_pretrained(
            MODEL_NAME,
            cache_dir=cache_dir,
            local_files_only=False
        )
        model.eval()  # Set to evaluation mode
        return feature_extractor, model
    except Exception as e:
        import traceback
        print(json.dumps({
            "error": f"Failed to load model: {str(e)}",
            "traceback": traceback.format_exc()
        }), file=sys.stderr)
        sys.exit(1)

def load_audio(file_path, target_sr=16000):
    """
    Load audio file and resample to target sample rate.
    The model expects 16kHz audio.
    """
    try:
        # Use librosa to load audio (handles multiple formats)
        audio, sr = librosa.load(file_path, sr=target_sr, mono=True)
        return audio, sr
    except Exception as e:
        print(json.dumps({"error": f"Failed to load audio: {str(e)}"}), file=sys.stderr)
        sys.exit(1)

def analyze_emotion(audio, sample_rate, feature_extractor, model):
    """
    Analyze emotion from audio waveform.
    Returns emotion scores for all 8 emotions.
    """
    try:
        # Prepare audio input for the model
        inputs = feature_extractor(audio, sampling_rate=sample_rate, return_tensors="pt", padding=True)

        # Run inference
        with torch.no_grad():
            logits = model(inputs.input_values).logits

        # Get probabilities using softmax
        probs = torch.nn.functional.softmax(logits, dim=-1)
        scores = probs[0].tolist()

        # Map scores to emotion labels
        emotion_scores = {emotion: score for emotion, score in zip(EMOTIONS, scores)}

        # Find primary emotion (highest score)
        primary_emotion = max(emotion_scores.items(), key=lambda x: x[1])

        return {
            "primary": primary_emotion[0],
            "confidence": primary_emotion[1],
            "all": emotion_scores
        }
    except Exception as e:
        print(json.dumps({"error": f"Failed to analyze emotion: {str(e)}"}), file=sys.stderr)
        sys.exit(1)

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: audio-emotion-analyzer.py <audio_file_path>"}), file=sys.stderr)
        sys.exit(1)

    audio_file = sys.argv[1]

    # Load model (only prints to stderr for debugging, not stdout)
    print("Loading emotion recognition model...", file=sys.stderr)
    feature_extractor, model = load_model()

    # Load audio
    print(f"Loading audio file: {audio_file}", file=sys.stderr)
    audio, sr = load_audio(audio_file)

    # Analyze emotion
    print("Analyzing emotions...", file=sys.stderr)
    emotion_result = analyze_emotion(audio, sr, feature_extractor, model)

    # Output result as JSON to stdout
    print(json.dumps({
        "success": True,
        "emotion": emotion_result,
        "audio_duration": len(audio) / sr
    }))

if __name__ == "__main__":
    main()
