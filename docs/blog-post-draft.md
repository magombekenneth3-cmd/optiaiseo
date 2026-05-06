# How I Built a Real-Time AI Voice SEO Strategist with Gemini 2.0 Live, LiveKit, and Google Cloud

> *I created this piece of content for the purposes of entering the Gemini Live Agent Challenge hackathon. #GeminiLiveAgentChallenge*

---

SEO in 2026 is broken. Not because the techniques don't work — they do — but because executing them requires specialist knowledge, dozens of tools, and hours of analysis that most founders and developers simply don't have. You shouldn't need a $10,000/month SEO agency to rank your product.

So I built **AISEO** — a voice-first AI agent that lets you *talk* to an SEO expert instead of reading dashboards. Just tell Aria (the agent) your domain and she audits your site, analyzes competitors, checks if your brand appears when people ask ChatGPT or Perplexity about your niche, and even opens a GitHub Pull Request to fix the issues — all through natural voice conversation.

---

## The Core Architecture

The key insight was to use **three separate stacks that work together**:

1. **Gemini 2.0 Flash Realtime** — the brain. Google's multimodal live API handles audio-in → audio-out with native Voice Activity Detection (VAD). This means Aria can detect when you start speaking and *immediately stop talking* — real barge-in, not polling.

2. **LiveKit** — the WebRTC layer. Running agents over raw WebSockets is painful; LiveKit gives you a managed WebRTC room, track management, and a clean agents SDK (`@livekit/agents`) that bridges your AI model to the browser.

3. **Next.js + Google Cloud Run** — the hosting layer. The frontend is a Next.js app with a custom WebSocket server. The LiveKit agent worker runs as a *separate* Cloud Run service, scaled independently of the web app.

```
Browser ↔ LiveKit Cloud ↔ Agent Worker (Cloud Run) ↔ Gemini 2.0 Live API
                                   ↓
                           Google Cloud Firestore
```

---

## Technical Implementation

### The Voice Agent (livekit-agent.ts)

```typescript
import { defineAgent, JobContext, WorkerOptions, cli, voice } from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";

export default defineAgent({
    entry: async (ctx: JobContext) => {
        await ctx.connect();
        const participant = await ctx.waitForParticipant();

        const realtimeModel = new google.beta.realtime.RealtimeModel({
            model: "gemini-2.0-flash-exp",
            apiKey: process.env.GEMINI_API_KEY,
            voice: "Puck",
            instructions: ARIA_INSTRUCTIONS, // detailed SEO expert persona
        });

        const agentSession = new voice.AgentSession({ llm: realtimeModel });
        agentSession.start({ agent: ctx.proc as any, room: ctx.room });
    },
});
```

The `@livekit/agents-plugin-google` package wraps Gemini's bidirectional streaming API and handles the low-level audio pipeline — PCM encoding, VAD signaling, and interruption. When a participant speaks, LiveKit sends the audio to the agent, the agent forwards it to Gemini Live, and Gemini streams audio back in real-time.

### The Frontend (React + LiveKitRoom)

```tsx
<LiveKitRoom
  token={livekitToken}
  serverUrl={livekitUrl}
  connect={true}
  audio={true}
  onDisconnected={disconnect}
>
  <AgentSessionProvider>
    <AgentAudioVisualizerAura state={agentState} audioTrack={micTrack} />
    <AgentControlBar controls={{ microphone: true, leave: true }} />
  </AgentSessionProvider>
</LiveKitRoom>
```

The premium 3D Aura visualizer uses a custom WebGL shader that responds to the agent's state (`connecting → listening → thinking → speaking`) with distinct animation modes — judges and users can *see* whether Aria is thinking or speaking at a glance.

### Grounding: AEO (Answer Engine Optimization)

One of the most differentiated features is AEO tracking. Instead of just checking Google rankings, Aria queries multiple AI engines directly to see if your brand appears:

```typescript
// Ask GPT-4, Claude, and Perplexity the same question a user would ask
const results = await Promise.allSettled([
  queryOpenAI(`Who is the best ${niche} tool for ${useCase}?`),
  queryClaude(`What are the top ${niche} platforms?`),
  queryPerplexity(`${brand} vs competitors for ${useCase}`),
]);
```

This is genuinely novel — most SEO tools don't even track AI visibility yet.

---

## What I Learned

**1. LiveKit's VAD is remarkable.** The barge-in detection (user speaking over the agent) works within 100-200ms latency over WebRTC, compared to 600-800ms over raw WebSockets. Choosing LiveKit was the right call.

**2. Google Cloud Run's session affinity flag is non-negotiable for WebSockets.** Without `--session-affinity`, WebSocket connections are round-robined between instances and immediately drop. Set it on deploy.

**3. Gemini 2.0 Flash Realtime is fast enough to feel magical.** End-to-end latency from user speech-end to agent speech-start is under 400ms. At that speed, it genuinely feels like talking to a person, not an LLM.

**4. Two services are better than one.** Separating the Next.js frontend from the LiveKit agent worker into two Cloud Run services means the agent can scale independently. A spike in voice sessions doesn't affect the web app's response times.

---

## Try It Yourself

The project is fully open-source and deployable in one command:

```bash
git clone https://github.com/YOUR_USERNAME/aiseo
cd aiseo && cp .env.example .env
# Fill in GEMINI_API_KEY, LIVEKIT_URL/KEY/SECRET
pnpm install && pnpm prisma db push
pnpm dev        # Terminal 1: Next.js
pnpm agent      # Terminal 2: Aria voice worker
```

Visit `http://localhost:3000`, sign up, and say *"Hey Aria, audit my site for SEO issues."*

---

## What's Next

- **Vision mode**: Let users share their screen and have Aria analyze analytics dashboards visually (Gemini multimodal)
- **Scheduled voice briefings**: Aria calls you each morning with your SEO digest
- **Multi-agent orchestration**: Separate specialized agents for Technical SEO, Content, and AEO that Aria delegates to

---

*Built during the Gemini Live Agent Challenge, March 2026. If you're building with Gemini Live and have questions, reach out — always happy to compare notes.*

*#GeminiLiveAgentChallenge #GoogleCloud #GeminiAI #SEO #LiveKit #BuildInPublic*
