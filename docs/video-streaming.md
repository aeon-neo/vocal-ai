# Real-Time Video Streaming & Behavioral Analysis

Real-time video analysis system for detecting emotions, moods, and sentiment during video chat interactions with Niimi. Enables empathetic, emotionally-aware AI responses.

## Overview

The video streaming system captures webcam frames and audio, analyzes behavioral cues using Claude Vision and audio transcription, and integrates emotional context directly into conversation flow.

### Key Features

- **Real-time emotion detection** (7 basic emotions, 5 mood states, sentiment analysis)
- **Video chat interface** with integrated conversation and behavioral analysis
- **Emotional context integration**: All user messages tagged with video/audio emotional state
- **Empathetic AI responses**: Cortex adapts tone based on detected emotions
- Real-time video frame analysis (60fps capture, 12fps analysis)
- Behavioral metrics: engagement, confusion, confidence, thinking patterns
- WebSocket-based bi-directional communication (Socket.IO)
- Smart frame throttling and deduplication (reduces API costs by 80%)
- Session-based multi-client support

### Architecture

```
Browser (Webcam) → WebSocket (60fps) → Frame Processor (12fps throttled)
                                              ↓
                                    Claude Vision Analysis
                                              ↓
                                    Behavioral Cues ←→ Browser UI
```

## Quick Start

### 1. Start the Video Stream Server

```bash
npm run video-server
```

This starts the WebSocket server on port 5443 by default.

### 2. Open the Video Chat Interface

Navigate to: http://localhost:5443/video-chat.html

### 3. Grant Webcam/Microphone Access

Allow webcam and microphone access when prompted by your browser.

### 4. Start Conversing with Niimi

The interface provides:

- **Video toggle**: Turn camera on/off (red = off, white = on)
- **Mic toggle**: Turn microphone on/off (red = off, white = on)
- **Recording button**: Red dot to start/stop recording (disabled when both video and mic are off)
- **Chat area**: Text chat always available (Enter to send)
- **Status bar**: Shows detected emotions during recording

### 5. Real-Time Emotional Analysis

During video/audio recording, the system analyzes:

- **7 basic emotions** with confidence scores (happy, sad, angry, fearful, surprised, disgusted, neutral)
- **5 mood states** with confidence scores (anxious, relaxed, frustrated, excited, focused)
- **Sentiment polarity** (-1 to +1 scale)
- **Behavioral cues** from video (engagement, confusion, confidence, thinking)
- **Audio emotions** from voice characteristics (tone, pitch, prosody, speaking rate, volume) via GPT-4o Audio

All emotional context is integrated into the conversation, enabling Cortex to respond with appropriate empathy and tone.

## Architecture Components

### 1. WebSocket Server (`video-stream-server.ts`)

Socket.IO server that handles WebSocket connections, receives video frames, and broadcasts behavioral analysis results.

**Key responsibilities:**

- Accept client connections
- Manage session-based rooms
- Process incoming video frames
- Broadcast behavioral cues to clients
- Handle errors and disconnections

**Configuration:**

```typescript
const server = new VideoStreamServer({
  port: 5443,
  corsOrigin: "*", // Restrict in production
  maxHttpBufferSize: 1e7, // 10MB for video frames
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});
```

### 2. Frame Processor (`frame-processor.ts`)

Intelligent frame processing with throttling and deduplication.

**Frame throttling strategy:**

- Analyzes every 5th frame (60fps → 12fps)
- Reduces API costs by 80%
- Maintains responsive feedback (<2s latency)

**Duplicate detection:**

- MD5 hashing of frame data
- Skips identical frames (no motion)
- Saves API calls when subject is still

**Output format:**

```typescript
{
  engagement: 0.72,        // 0-1 scale
  confusion: 0.35,         // 0-1 scale
  confidence: 0.68,        // 0-1 scale
  thinking: true,          // boolean
  cues: [                  // string array
    "steady eye contact",
    "looking up while pausing"
  ],
  timestamp: 1234567890
}
```

### 3. Vision Service (`vision-service.ts`)

Claude Vision API integration for behavioral analysis.

**New method: `analyzeBehavior()`**

- Input: Base64 encoded video frame
- Output: Structured behavioral assessment
- Model: Claude Sonnet 4.5
- Tokens: ~500 max per analysis
- Latency: ~500ms-1s per frame

**Analysis focuses on:**

- Engagement: Eye contact, attention, posture
- Confusion: Furrowed brow, hesitation, looking away
- Confidence: Upright posture, steady gaze, gestures
- Thinking: Pauses, looking up (cognitive processing)

### 4. Behavioral Types (`behavioral-types.ts`)

TypeScript interfaces for type safety:

- `BehavioralAnalysis`: Analysis results structure
- `VideoFrameData`: Client → Server frame data
- `BehavioralCuesEvent`: Server → Client results
- `VisionBehavioralResponse`: Claude API response

### 5. Video Chat Client (`video-chat.html`)

Browser-based chat interface with:

- WebRTC webcam and microphone capture
- Socket.IO client connection
- Real-time emotional analysis display
- Video/mic toggle controls
- Recording button (red dot) with status indicator
- Text chat interface with markdown support
- File attachment support (drag-and-drop)
- Connection status indicator
- Emotion display in status bar during recording

## Usage Examples

### Starting the Server Programmatically

```typescript
import { VideoStreamServer } from "./websocket/video-stream-server";

const server = new VideoStreamServer({
  port: 8080,
  anthropicApiKey: "sk-ant-...",
});

server.start();

// Get statistics
const stats = server.getStats();
console.log(`Connected clients: ${stats.connectedClients}`);
console.log(`Frames analyzed: ${stats.frameProcessingStats.analyzedFrames}`);
```

### Client Integration (JavaScript)

```javascript
// Connect to server
const socket = io("http://localhost:5443");
const sessionId = "my-session-123";

socket.on("connect", () => {
  socket.emit("join-session", sessionId);
});

// Send video frames
const captureFrame = () => {
  const canvas = document.getElementById("canvas");
  const frameBase64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];

  socket.emit("video-frame", {
    sessionId: sessionId,
    frame: frameBase64,
    timestamp: Date.now(),
  });
};

// Receive behavioral cues
socket.on("behavioral-cues", (data) => {
  console.log("Engagement:", data.engagement);
  console.log("Confusion:", data.confusion);
  console.log("Confidence:", data.confidence);
  console.log("Thinking:", data.thinking);
  console.log("Cues:", data.cues);
});
```

## Performance & Cost Optimization

### Frame Throttling

- Capture: 60fps (smooth user experience)
- Analysis: 12fps (cost-effective)
- Reduction: 80% fewer API calls

### Latency Targets

- Frame capture → WebSocket: <50ms
- WebSocket → Claude Vision: <1000ms
- Claude Vision → Response: <500ms
- Total end-to-end: <2s

### Cost Calculation

Assuming 60fps capture, 12fps analysis:

| Component         | Rate  | Cost/hour     | Notes                |
| ----------------- | ----- | ------------- | -------------------- |
| Frame capture     | 60fps | $0            | Browser-side, free   |
| Claude Vision     | 12fps | ~$2.16/hr     | 43,200 frames/hr     |
| WebSocket hosting | N/A   | ~$0.05/hr     | Minimal bandwidth    |
| **Total**         | -     | **~$2.22/hr** | Acceptable for demos |

**Further optimization:**

- Reduce analysis rate to 6fps: $1.11/hr
- Use Haiku model: $0.54/hr (lower accuracy)
- Implement local CV for motion detection: $0.27/hr (hybrid approach)

### Production Recommendations

1. **Authentication & Authorization**

   - Session tokens for client connections
   - API key validation
   - Rate limiting per session

2. **Encryption**

   - WSS (WebSocket Secure) with TLS certificates
   - End-to-end encryption for video frames
   - Secure storage of API keys

3. **Privacy Compliance**

   - Explicit user consent before webcam access
   - Clear data retention policy (no video storage)
   - GDPR compliance (right to deletion, data export)
   - Student opt-out (text-only mode)

4. **Data Handling**
   - No persistent storage of video frames
   - Store only behavioral metrics (no images)
   - Aggregate anonymized statistics
   - Delete session data after 30 days

## Troubleshooting

### Server won't start

**Issue:** Port 5443 already in use

**Solution:**

```bash
npm run video-server -- --port=8080
```

### No webcam access

**Issue:** Browser blocks camera access

**Solution:**

- Check browser permissions (chrome://settings/content/camera)
- Ensure HTTPS or localhost (required for getUserMedia)
- Try different browser (Chrome/Firefox recommended)

### High latency (>5s)

**Issue:** Slow Claude Vision API responses

**Possible causes:**

- API rate limiting
- Network latency
- High server load

**Solutions:**

- Check API quota/limits
- Reduce frame rate further (6fps)
- Use Haiku model for faster responses
- Implement local motion detection first

### Connection drops

**Issue:** WebSocket disconnecting frequently

**Solutions:**

- Check network stability
- Increase Socket.IO timeout settings
- Enable automatic reconnection (already default)

## Related Documentation

- [Vision Service](../src/vision-service.ts) - Image/video analysis implementation

## Support

For questions or issues:

- GitHub Issues: https://github.com/your-org/niimi/issues
- General Niimi Help: See README.md
