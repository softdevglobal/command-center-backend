# AI Agent Setup Guide

Step-by-step instructions to build the AI phone agents for BMS Black, Trade (Blue), Pink and
onboarding, using the recommended third-party stack.

Read with:

- [ai.md](ai.md): architecture and theory (why).
- [ai-errors-and-improvements.md](ai-errors-and-improvements.md): defects to fix and the
  multi-agent design (what).
- This file: how to build it (how).

> **Verify before you copy.** Vendor SDKs move fast. Package names, class names, model ids
> and CLI flags below match the vendors' documented APIs at the time of writing, but check
> each against the current docs for the version you install. Places most likely to drift are
> marked **(check)**. Nothing in this guide has been run yet.

---

## Contents

- [0. What you will build](#0-what-you-will-build)
- [1. Choose the stack](#1-choose-the-stack)
- [2. Accounts and keys](#2-accounts-and-keys)
- [3. Project layout](#3-project-layout)
- [4. Step 1: prepare the backend](#4-step-1-prepare-the-backend)
- [5. Step 2: connect the phones (Yeastar → LiveKit SIP)](#5-step-2-connect-the-phones-yeastar--livekit-sip)
- [6. Step 3: build the voice agent worker](#6-step-3-build-the-voice-agent-worker)
- [7. Step 4: brand profiles and prompts](#7-step-4-brand-profiles-and-prompts)
- [8. Step 5: background agents (Claude API)](#8-step-5-background-agents-claude-api)
- [9. Step 6: telemetry](#9-step-6-telemetry)
- [10. Step 7: test locally](#10-step-7-test-locally)
- [11. Step 8: deploy](#11-step-8-deploy)
- [12. Alternative A: ElevenLabs Agents (managed)](#12-alternative-a-elevenlabs-agents-managed)
- [13. Alternative B: Google speech-to-text in the pipeline](#13-alternative-b-google-speech-to-text-in-the-pipeline)
- [14. Alternative C: keep OpenAI Live](#14-alternative-c-keep-openai-live)
- [15. Go-live checklist](#15-go-live-checklist)

---

## 0. What you will build

```
                      ┌──────────────────────────── LiveKit (Cloud or self-hosted) ───────────────────────────┐
 Caller ─► Yeastar ─► │ SIP inbound trunk ─► dispatch rule ─► room "call-<id>"                                 │
          PBX         │                                          │                                             │
                      │                                          ▼                                             │
                      │                         Voice agent worker (Python, LiveKit Agents)                    │
                      │                         ┌─────────────────────────────────────────────┐               │
                      │                         │ noise cancel (Krisp/BVC) ─► VAD (Silero)    │               │
                      │                         │ ─► STT (Deepgram) ─► turn detector          │               │
                      │                         │ ─► LLM (Claude) ◄──► MCP tools ─────────────┼──┐            │
                      │                         │ ─► TTS (ElevenLabs) ─► caller                │  │            │
                      │                         └─────────────────────────────────────────────┘  │            │
                      └──────────────────────────────────────────────────────────────────────────┼────────────┘
                                                                                                 │ HTTPS
                      ┌──────────────────────────── command-center-backend (this repo) ──────────▼────────────┐
                      │ POST /api/ai/voice/profile   → which brand, prompt, voice, MCP URL, transfer target   │
                      │ POST /api/ai/mcp/black|trade|pink|onboarding-call  → tools (existing MCP servers)     │
                      │ POST /api/ai/agent-activity  → call events                                            │
                      │ Background worker            → summary + QA agents (Claude API)                       │
                      └───────────────────────────────────────────────────────────────────────────────────────┘
```

Key idea: **the voice worker knows nothing about workshops.** It asks the backend "who
answers this number?" and receives a profile. All business rules, tenant scoping and booking
logic stay in this repo, behind the MCP servers you already have.

---

## 1. Choose the stack

### 1.1 Recommended

| Layer | Pick | Why | Alternative |
|---|---|---|---|
| Telephony | **Yeastar** (keep) → SIP trunk | Already in place | Twilio / Telnyx if you need cloud numbers |
| Voice runtime | **LiveKit Agents** (Python) on **LiveKit Cloud** | Built-in SIP, noise cancellation, turn detection, MCP client, plugin for every vendor below | Pipecat; self-hosted LiveKit |
| Noise cancellation | **LiveKit BVC Telephony** (Krisp-based, Cloud only) | Tuned for phone audio | RNNoise if self-hosting |
| VAD | **Silero** | Open source, robust in noise | — |
| Turn detection | **LiveKit turn-detector model** | Fewer mid-sentence interruptions | Silence-based endpointing |
| STT | **Deepgram** (Nova family, `en-AU`) | Fast, accurate on phone audio, keyword boosting | Google STT (section 13), AssemblyAI |
| LLM | **Claude** (`claude-opus-5-5` default; see 1.2) | Strong tool use, follows rules, good at read-back | GPT / Gemini via the same plugin system |
| TTS | **ElevenLabs** (low-latency Flash model, Australian voice) | Most natural voices | Cartesia, Deepgram Aura, Google TTS |
| Tools | **Your MCP servers** (existing) | Already secure and tenant-scoped | — |
| Background agents | **Claude API** from this backend | Summaries, QA scoring | — |
| Session store | **Redis** (or Supabase table) | Shared state across replicas | — |

### 1.2 Choosing the live-agent model

The live agent's model choice is a latency-versus-quality decision you should make by
measuring, not guessing:

| Model | Use | Notes |
|---|---|---|
| `claude-opus-5-5` | Default in this guide | Strongest at following booking rules. Thinking is always on; run it at **low effort** for voice. Measure response latency. |
| `claude-haiku-5-5` | Option if latency or cost matter more | Much cheaper and typically faster. Try it on the test call scripts and compare. |
| `claude-sonnet-5-5` | Background agents if you want cheaper than Opus | Good judgment for summaries and QA. |

Set the model through `AI_AGENT_LLM_MODEL` so you can switch without code changes.

### 1.3 When to choose something else

| Situation | Choose |
|---|---|
| You do not want to run a worker at all | ElevenLabs Agents (section 12) |
| You are standardising on Google Cloud | Google STT inside the same pipeline (section 13) |
| You only need a quick fix to the pilot | Keep OpenAI Live and apply the error fixes (section 14) |

---

## 2. Accounts and keys

| Service | Create | You need | Env var (worker) |
|---|---|---|---|
| LiveKit Cloud | Project (pick an Australian region if offered) | URL, API key, API secret | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Deepgram | Project | API key | `DEEPGRAM_API_KEY` |
| ElevenLabs | Workspace | API key, voice id | `ELEVEN_API_KEY` **(check name for plugin version)**, `ELEVEN_VOICE_ID` |
| Anthropic | Workspace | API key | `ANTHROPIC_API_KEY` |
| This backend | — | Voice bridge secret (≥ 32 chars) | `BMSPRO_API_URL`, `BMSPRO_BRIDGE_SECRET` |
| Yeastar | Admin access | Ability to add a SIP trunk and outbound route | — |

Backend env vars (this repo): keep the existing `AI_*` variables and add:

```env
ANTHROPIC_API_KEY=...
AI_BACKGROUND_MODEL=claude-opus-5-5
AI_BACKGROUND_AGENTS=summary,qa
AI_VOICE_RUNTIME=livekit
```

Rules:

- Store keys in your secret manager, never in git.
- Use separate keys for staging and production.
- The worker's `BMSPRO_BRIDGE_SECRET` is the same value as the backend's
  `AI_VOICE_BRIDGE_SECRET`. Onboarding uses `AI_ONBOARDING_BRIDGE_SECRET` (must differ).

---

## 3. Project layout

Two deployables:

```
command-center-backend/          ← this repo (TypeScript, Express) – tools, rules, background agents
  src/routes/ai/voice-profile.routes.ts     (new)
  src/ai/background/                        (new)
  ...

bmspro-voice-agent/              ← new repo or folder (Python) – the LiveKit worker
  agent.py
  profiles.py
  backend_client.py
  requirements.txt
  Dockerfile
  livekit/
    inbound-trunk.json
    dispatch-rule.json
  .env.example
```

Why Python for the worker: LiveKit Agents' Python SDK is the most complete (plugins, turn
detector, noise cancellation). A Node SDK exists; check feature parity before choosing it.

---

## 4. Step 1: prepare the backend

### 4.1 Fix first

From [ai-errors-and-improvements.md](ai-errors-and-improvements.md), these matter for the new
runtime too:

- [ ] **E11** prune the Black rate-limit map.
- [ ] **E9 (partial)** make sure the Black MCP keeps slot offers for the life of one MCP
      session. LiveKit's MCP client keeps one session per call, so this already works for a
      single replica. For multiple replicas, do the session-store work.
- [ ] **E7** decide on email capture (optional email + SMS link recommended).

### 4.2 Add a profile endpoint

The worker needs one call per incoming call: "this DID was dialed; how should I answer?"

`POST /api/ai/voice/profile`
Headers: `Authorization: Bearer <bridge secret>`, `x-bmspro-did: <digits>`

Response:

```json
{
  "brand": "black",
  "callToken": "opaque-id-for-this-call",
  "mcp": { "url": "https://api.example.com/api/ai/mcp/black", "headers": { "x-bmspro-did": "61290000000" } },
  "instructions": "You are the phone receptionist for Smith Motors, Parramatta...",
  "greeting": "Thanks for calling Smith Motors Parramatta, how can I help?",
  "voice": { "provider": "elevenlabs", "voiceId": "..." },
  "language": "en-AU",
  "transferTo": "sip:reception@pbx.example.com",
  "maxCallSeconds": 600
}
```

Sketch (fits beside `voice-route.routes.ts`, reusing its auth):

```ts
// src/routes/ai/voice-profile.routes.ts
import { Router } from "express";
import { resolveVoiceProductForDid } from "../../services/ai/voice-route.service.js";
import { getDidMappingByDid } from "../../services/did-mappings.service.js";
import { buildProfile } from "../../services/ai/voice-profiles.service.js";   // new

const router = Router();

router.post("/", async (req, res) => {
  if (process.env.AI_FEATURE_ENABLED !== "true") { res.status(404).end(); return; }
  if (!validBridgeCredential(bearerFrom(req))) { res.status(401).end(); return; }   // same as voice-route
  const did = req.header("x-bmspro-did")?.trim() ?? "";
  try {
    const route = isOnboardingDid(did)
      ? { brand: "onboarding" as const, did }
      : await resolveVoiceProductForDid(did);           // black | trade (extend for pink)
    const mapping = await getDidMappingByDid(did) ?? await getDidMappingByDid(`+${did}`);
    res.setHeader("Cache-Control", "no-store");
    res.json(await buildProfile(route.brand, did, mapping));
  } catch {
    res.status(404).json({ error: "DID is not mapped to an available voice product." });
  }
});

export default router;
```

Mount it in `src/routes/index.ts`:

```ts
router.use("/ai/voice/profile", voiceProfileRoutes);
```

`buildProfile` returns the brand's prompt (section 7), voice, MCP URL and transfer target.
Keep the prompts in this repo so changing a prompt is a backend deploy, not a worker deploy.

### 4.3 Accept the worker as an MCP client

The existing Black and Trade MCP routes already accept `Authorization: Bearer <bridge
secret>` plus `x-bmspro-did`, so the LiveKit worker can call them exactly like the Yeastar
bridge does. Two checks:

- `AI_VOICE_PROVIDER` is checked for `"yeastar"` in `yeastar-mcp.routes.ts`,
  `trade-mcp.routes.ts` and `voice-route.routes.ts`. Allow `"livekit"` too, or rename the
  check to a list.
- Onboarding MCP requires `x-bmspro-onboarding-call` (a UUID). Have the profile endpoint
  return one per call and pass it in `mcp.headers`.

---

## 5. Step 2: connect the phones (Yeastar → LiveKit SIP)

### 5.1 How the call flows

```
Caller dials 02 9000 0000
   │
   ▼
Yeastar inbound route (DID 0290000000)
   │  route to SIP trunk "LiveKit-AI"
   ▼
LiveKit SIP inbound trunk  (checks source IP / credentials)
   │
   ▼
Dispatch rule: new room per call, dispatch agent "bmspro-receptionist"
   │
   ▼
Worker joins room; SIP participant attributes include the dialed number
```

The dialed number comes from the trunk, not from anything the caller can change. That fixes
**E1** (the single test DID) for this runtime.

### 5.2 Create the LiveKit side **(check field names against current LiveKit SIP docs)**

`livekit/inbound-trunk.json`:

```json
{
  "trunk": {
    "name": "yeastar-inbound",
    "numbers": ["+61290000000", "+61290000001"],
    "allowed_addresses": ["<yeastar public IP>/32"],
    "auth_username": "<username>",
    "auth_password": "<strong password>",
    "krisp_enabled": true
  }
}
```

`livekit/dispatch-rule.json`:

```json
{
  "dispatch_rule": {
    "rule": { "dispatchRuleIndividual": { "roomPrefix": "call-" } },
    "name": "bmspro-ai",
    "room_config": { "agents": [{ "agent_name": "bmspro-receptionist" }] }
  }
}
```

Create them with the LiveKit CLI:

```bash
lk sip inbound create livekit/inbound-trunk.json
lk sip dispatch create livekit/dispatch-rule.json
```

### 5.3 Configure Yeastar

In the Yeastar admin (exact menus vary by model and firmware):

1. **Add a SIP trunk** pointing at your LiveKit project's SIP URI (shown in LiveKit Cloud
   settings). Use the same username and password as the inbound trunk. Prefer TLS and SRTP if
   both sides support it.
2. **Codec:** enable G.722 (wideband) first, then G.711 as fallback.
3. **Inbound route** for each AI-handled DID: destination = the LiveKit trunk.
4. **Failover:** if the trunk is unreachable or rejects the call, route to the normal ring
   group or voicemail. Test this. It is the safety net for every failure in the agent.

### 5.4 Transfers back to staff

The agent transfers by sending a SIP REFER through LiveKit to the `transferTo` URI from the
profile. Yeastar must accept the REFER and ring the staff extension or ring group. Test a
transfer early: REFER support varies between PBX setups.

---

## 6. Step 3: build the voice agent worker

### 6.1 Install

`requirements.txt` **(check current versions and extras names)**:

```text
livekit-agents[deepgram,elevenlabs,anthropic,silero,turn-detector,mcp]~=1.2
livekit-plugins-noise-cancellation~=0.2
httpx~=0.27
python-dotenv~=1.0
```

```bash
python -m venv .venv
. .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python agent.py download-files    # fetches the VAD and turn-detector model files
```

### 6.2 Backend client

```python
# backend_client.py
import os
import httpx

API = os.environ["BMSPRO_API_URL"].rstrip("/")
SECRET = os.environ["BMSPRO_BRIDGE_SECRET"]


async def get_profile(did_digits: str) -> dict:
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.post(
            f"{API}/api/ai/voice/profile",
            headers={"Authorization": f"Bearer {SECRET}", "x-bmspro-did": did_digits},
        )
        r.raise_for_status()
        return r.json()


async def send_event(event: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.post(
                f"{API}/api/ai/agent-activity",
                headers={"Authorization": f"Bearer {SECRET}"},
                json=event,
            )
    except httpx.HTTPError:
        pass  # telemetry must never break a call
```

### 6.3 The agent **(check class and argument names for your LiveKit Agents version)**

```python
# agent.py
import asyncio
import os
import time

from dotenv import load_dotenv
from livekit import api
from livekit.agents import (
    Agent, AgentSession, JobContext, RoomInputOptions, RunContext,
    WorkerOptions, cli, function_tool, mcp,
)
from livekit.plugins import anthropic, deepgram, elevenlabs, noise_cancellation, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from backend_client import get_profile, send_event

load_dotenv()

LLM_MODEL = os.environ.get("AI_AGENT_LLM_MODEL", "claude-opus-5-5")
TOOL_FILLER = "One moment while I check that."


class Receptionist(Agent):
    def __init__(self, ctx: JobContext, profile: dict, caller_identity: str):
        super().__init__(instructions=profile["instructions"])
        self._ctx = ctx
        self._profile = profile
        self._caller = caller_identity

    @function_tool()
    async def transfer_to_staff(self, context: RunContext) -> str:
        """Transfer the caller to a staff member. Use when the caller asks for a person,
        or when a tool fails and staff are needed. Only say you transferred after this succeeds."""
        target = self._profile.get("transferTo")
        if not target:
            return "No staff transfer is available. Offer to take a callback request instead."
        await context.session.say("I'll put you through to the team now.")
        await self._ctx.api.sip.transfer_sip_participant(
            api.TransferSIPParticipantRequest(
                room_name=self._ctx.room.name,
                participant_identity=self._caller,
                transfer_to=target,
            )
        )
        await send_event({"type": "call.transferred", "callId": self._ctx.room.name,
                          "brand": self._profile["brand"]})
        return "Transferred."


async def entrypoint(ctx: JobContext):
    await ctx.connect()
    caller = await ctx.wait_for_participant()

    # Dialed number from the SIP trunk (trusted). Strip to digits for the backend.
    dialed = caller.attributes.get("sip.trunkPhoneNumber", "")
    did = "".join(ch for ch in dialed if ch.isdigit())

    try:
        profile = await get_profile(did)
    except Exception:
        # No profile = do not let the AI answer. Hang up so Yeastar fails over.
        await send_event({"type": "call.rejected", "callId": ctx.room.name, "reason": "no_profile"})
        await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
        return

    started = time.monotonic()
    await send_event({"type": "call.started", "callId": ctx.room.name, "brand": profile["brand"]})

    session = AgentSession(
        stt=deepgram.STT(model="nova-3", language=profile.get("language", "en-AU")),  # (check locale support)
        llm=anthropic.LLM(model=LLM_MODEL),
        tts=elevenlabs.TTS(voice_id=profile["voice"]["voiceId"], model="eleven_flash_v2_5"),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
        mcp_servers=[
            mcp.MCPServerHTTP(
                url=profile["mcp"]["url"],
                headers={
                    "Authorization": f"Bearer {os.environ['BMSPRO_BRIDGE_SECRET']}",
                    **profile["mcp"].get("headers", {}),
                },
                timeout=10,
            )
        ],
    )

    # Hook for per-tool telemetry (section 9). Event name may differ by version (check).
    @session.on("function_tools_executed")
    def _on_tools(_event):
        pass

    await session.start(
        room=ctx.room,
        agent=Receptionist(ctx, profile, caller.identity),
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVCTelephony(),   # LiveKit Cloud only
        ),
    )

    await session.say(profile["greeting"], allow_interruptions=True)

    # Hard cap on call length.
    async def _limit():
        await asyncio.sleep(profile.get("maxCallSeconds", 600))
        await session.say("I'm sorry, I need to wrap up. I'll pass your details to the team.")
        await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))

    limiter = asyncio.create_task(_limit())

    async def _on_shutdown():
        limiter.cancel()
        await send_event({
            "type": "call.ended", "callId": ctx.room.name, "brand": profile["brand"],
            "durationSeconds": round(time.monotonic() - started),
        })

    ctx.add_shutdown_callback(_on_shutdown)


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="bmspro-receptionist"))
```

What each part does:

| Part | Role | Fixes |
|---|---|---|
| `sip.trunkPhoneNumber` | Trusted dialed number | E1 |
| `get_profile` failure → delete room | Caller falls through to Yeastar failover | E2 |
| `mcp.MCPServerHTTP` | Uses your existing MCP servers; one MCP session per call | E16 (tools defined once, in the backend) |
| `BVCTelephony`, `silero.VAD`, `MultilingualModel` | Noise, VAD, turn detection | E6 |
| `transfer_to_staff` | SIP REFER via LiveKit | Human fallback |
| `_limit` | Max call duration | I15 |
| `send_event` | Call telemetry | E18 |

### 6.4 Filler phrases

Two ways, use both:

1. **Prompt rule:** "Before you use a tool, say a short phrase such as 'One moment while I
   check that.'" (in every profile's instructions).
2. **Code:** LiveKit Agents lets you react when the LLM starts a tool call. Use it to
   `session.say(TOOL_FILLER)` if the tool has not returned within ~800 ms. **(check the event
   name in your version.)**

### 6.5 Tool timeouts

MCP calls already have `timeout=10` above. Inside the backend, add per-tool timeouts as
described in E5, so a slow upstream returns a safe error instead of hanging.

---

## 7. Step 4: brand profiles and prompts

The backend's `buildProfile(brand, did, mapping)` returns one of these.

### 7.1 Shared rules (prepend to every brand)

```text
You are speaking on a phone call. Keep each reply to one or two short sentences.
Ask one question at a time. Never read out lists longer than three items.

Every fact must come from a tool. Never invent services, prices, hours or availability.

If you did not clearly hear a name, number, registration or email, ask the caller to repeat
or spell it. Read phone numbers back in groups (0412, 345, 678) and registrations letter by
letter. Never guess a detail to avoid asking again.

Before you use a tool, say a short phrase such as "One moment while I check that."

If a tool fails or returns UNKNOWN, do not claim success. Offer to transfer to staff.
If the caller asks for a person, transfer straight away.
Never say a booking or request is "confirmed". Say it has been submitted for the team to approve.
```

### 7.2 Black

```text
You are the phone receptionist for {workshopName}, {branchName}.
Bookings here are drop-off requests that staff approve. A drop-off time is not an exclusive
mechanic appointment.
Flow: find the service (list_services) → ask the date → get_available_slots → offer up to
three times → collect name, mobile number and registration → read everything back → only
after a clear yes, create_booking with the slotToken.
If the caller's vehicle type affects the price, ask for it; never guess.
```

Tools (from `/api/ai/mcp/black`): `get_workshop_profile`, `list_services`,
`get_available_slots`, `create_booking` (when enabled).

### 7.3 Trade (Blue)

```text
You are the phone receptionist for {businessName}.
Callers request on-site inspections. Customers choose preferred morning or afternoon
sessions; staff review every request.
Flow: service → site address → preferred sessions (get_available_slots shows unavailable
ones) → name and mobile → read back → after a clear yes, create_inspection_request.
Create one requestKey per request and reuse it on retries.
```

Tools (from `/api/ai/mcp/trade`): `get_business_profile`, `list_services`,
`get_available_slots`, `create_inspection_request` (when enabled).

### 7.4 Pink (after the Pink decisions in ai.md section 17)

```text
You are the receptionist for {businessName}, {branchName}.
Services can be done by specific staff. Ask whether the caller has a preferred staff member.
Flow: service → staff preference (list_staff_for_service) → date → get_available_slots →
offer times → name and mobile → read back → after a clear yes, create_booking.
```

Tools (new `/api/ai/mcp/pink`, built from the Pink proxies listed in ai.md section 9.2).

### 7.5 Onboarding

Use the existing `instructions` from `createLiveOnboardingTools` and the
`/api/ai/mcp/onboarding-call` MCP server. Its rules (published terms, operator id, separate
bridge secret) stay as they are.

### 7.6 Voices

| Brand | Voice style | Setting |
|---|---|---|
| Black | Friendly, practical, Australian | `ELEVEN_VOICE_ID_BLACK` |
| Trade | Calm, professional, Australian | `ELEVEN_VOICE_ID_TRADE` |
| Pink | Warm, welcoming, Australian | `ELEVEN_VOICE_ID_PINK` |
| Onboarding | Clear, patient | `ELEVEN_VOICE_ID_ONBOARDING` |

Pick voices by listening to each on a real phone line, not on headphones. Phone audio
removes high frequencies, so bright voices can sound harsh.

---

## 8. Step 5: background agents (Claude API)

These run in this backend after each call. They add no delay for the caller.

### 8.1 Install

```bash
npm install @anthropic-ai/sdk
```

`zod` is already a dependency.

### 8.2 Summary agent

```ts
// src/ai/background/summary.agent.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const client = new Anthropic();
const MODEL = process.env.AI_BACKGROUND_MODEL ?? "claude-opus-5-5";

export const CallSummary = z.object({
  reason: z.string().describe("Why the caller rang, in one short sentence."),
  outcome: z.enum(["booking_submitted", "question_answered", "transferred", "callback_requested", "abandoned", "failed"]),
  customerName: z.string().nullable(),
  nextAction: z.string().describe("What staff should do next, or 'none'."),
  summary: z.string().describe("Three to five short lines for staff."),
});

export async function runSummaryAgent(call: {
  brand: string; durationSeconds: number; toolOutcomes: unknown[]; transcript?: string;
}) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(CallSummary) },
    system:
      "You summarise phone calls handled by an AI receptionist for workshop staff. " +
      "Use only the facts in the call record. Do not invent details. Write plainly.",
    messages: [{ role: "user", content: JSON.stringify(call) }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return response.parsed_output;
}
```

### 8.3 QA agent

```ts
// src/ai/background/qa.agent.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const client = new Anthropic();
const MODEL = process.env.AI_BACKGROUND_MODEL ?? "claude-opus-5-5";

const CHECKS = [
  "greeting_named_correct_business",
  "facts_only_from_tools",
  "read_back_before_booking",
  "never_said_confirmed",
  "asked_again_when_unclear",
  "no_long_silence",
  "request_resolved_or_handed_over",
] as const;

export const CallQa = z.object({
  score: z.number().int().min(0).max(100),
  failedChecks: z.array(z.enum(CHECKS)),
  notes: z.string().describe("One or two sentences on the most important problem, or 'none'."),
});

export async function runQaAgent(call: { brand: string; toolOutcomes: unknown[]; transcript?: string; events: unknown[] }) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "medium", format: zodOutputFormat(CallQa) },
    system:
      "You review phone calls handled by an AI receptionist. Score the call 0-100 against these " +
      `checks: ${CHECKS.join(", ")}. A check fails only if the record shows it failed. ` +
      "If there is no transcript, judge only what the events and tool outcomes show.",
    messages: [{ role: "user", content: JSON.stringify(call) }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return response.parsed_output;
}
```

### 8.4 Worker loop

```ts
// src/ai/background/worker.ts
import { runSummaryAgent } from "./summary.agent.js";
import { runQaAgent } from "./qa.agent.js";

const enabled = new Set((process.env.AI_BACKGROUND_AGENTS ?? "").split(",").map(s => s.trim()));

export async function processCallEnded(event: CallEndedEvent) {
  if (!(await claimEvent(event.id))) return;          // idempotent across replicas (ai_call_events)
  const record = await loadCallRecord(event.callId);  // events + tool outcomes (+ transcript if retained)
  if (enabled.has("summary")) await saveSummary(event.callId, await runSummaryAgent(record));
  if (enabled.has("qa")) await saveQa(event.callId, await runQaAgent(record));
  await markProcessed(event.id);
}

export function startBackgroundWorker() {
  setInterval(async () => {
    for (const event of await fetchUnprocessed("call.ended", 20)) {
      try { await processCallEnded(event); }
      catch (error) { console.error("[ai background] failed", event.id, error); }
    }
  }, 15_000);
}
```

Tables: `ai_call_events`, `ai_call_summaries`, `ai_call_qa` (SQL in
[ai-errors-and-improvements.md section 3.6](ai-errors-and-improvements.md#36-data-model)).

### 8.5 Handling API errors

Use the SDK's typed errors, not message strings:

```ts
try { /* runSummaryAgent(...) */ }
catch (error) {
  if (error instanceof Anthropic.RateLimitError) { /* leave unprocessed; retry next tick */ }
  else if (error instanceof Anthropic.APIError) { console.error(`Claude API ${error.status}`); }
  else throw error;
}
```

Do not send `temperature`; current models reject it. Use `output_config.effort` instead.

---

## 9. Step 6: telemetry

Events the worker sends to `/api/ai/agent-activity`:

| Event | When | Fields |
|---|---|---|
| `call.started` | Profile loaded | callId, brand |
| `call.rejected` | No profile | callId, reason |
| `tool.called` | After each MCP call | callId, tool, ms, status (no arguments, no PII) |
| `call.transferred` | Transfer succeeded | callId, brand |
| `call.ended` | Shutdown | callId, brand, durationSeconds |
| `latency` | Each agent turn | callId, sttMs, llmTtftMs, ttsTtfbMs **(LiveKit exposes metrics events; check names)** |

Check the activity route's accepted schema in `src/routes/ai/ai-agent-activity.routes.ts`
and extend it if these event types are not accepted yet.

Dashboard (admin panel): calls per brand, transfer rate, tool error rate, p50/p95 response
latency, QA score trend, worst ten calls this week.

---

## 10. Step 7: test locally

### 10.1 Without a phone

```bash
python agent.py console    # talk to the agent through your microphone (check command name)
python agent.py dev        # connect to LiveKit Cloud; join from the LiveKit playground
```

For console or playground testing there is no SIP participant, so set a fallback DID through
an env var (for example `DEV_DID=61290000000`) and use it when `sip.trunkPhoneNumber` is
empty. **Only in development.**

### 10.2 With a phone

1. Point one test DID on Yeastar at the LiveKit trunk.
2. Map that DID to a test workshop in `did_mappings`.
3. Run `python agent.py dev`.
4. Call it and run the scripts in [ai.md section 16.3](ai.md#163-call-scripts-manual-per-release):
   hours, price, booking, correction during read-back, no availability, ask for a person,
   noisy room, speakerphone, talking over the agent, 20 seconds of silence.
5. Check the Black admin for the pending drop-off request.
6. Check `ai_call_summaries` and `ai_call_qa` for the call.

### 10.3 What good looks like

| Metric | Target |
|---|---|
| Median time from caller stopping to agent speaking | < 1.2 s |
| Phone number right on first read-back | 9 of 10 calls |
| Mid-sentence interruptions | 0–1 per call |
| Silence over 5 s | 0 |
| Transfer works | Every time |
| Failover when the worker is stopped | Caller reaches the ring group |

If latency is too high: lower effort, try `claude-haiku-5-5`, check worker region, and look
at turn-detection settings before anything else.

---

## 11. Step 8: deploy

### 11.1 Worker

`Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python agent.py download-files
CMD ["python", "agent.py", "start"]
```

Options:

- **LiveKit Cloud agent hosting** (simplest; check availability for your plan and region).
- **Your own container platform** (Fly.io, Railway, ECS, Cloud Run with min instances). Run
  at least two workers so a deploy does not drop calls.

Place workers in the same region as LiveKit and as close to Australia as possible.

### 11.2 Backend

Normal backend deploy, plus:

- New route `/api/ai/voice/profile`.
- `AI_VOICE_PROVIDER` accepts `livekit`.
- Background worker started from `src/server.ts` when `AI_BACKGROUND_AGENTS` is set.
- New tables created with RLS.

### 11.3 Rollout

1. One internal test DID.
2. One friendly workshop, business hours only, bookings flag **off** (answers and transfers
   only).
3. Same workshop, bookings flag **on**.
4. Five workshops. Watch QA scores and transfer rate daily.
5. All Black workshops; then Trade; then Pink.

Keep the old Yeastar bridge route working for tenants not yet moved.

---

## 12. Alternative A: ElevenLabs Agents (managed)

Use this if you want ElevenLabs voice quality without running a worker.

```
Caller ─► Yeastar ─► SIP ─► ElevenLabs Agents (STT + LLM + TTS + turn-taking)
                                      │ tool calls
                                      ▼
                          Your MCP servers / webhooks (this backend)
```

Steps **(check the current ElevenLabs Agents docs for exact menus and fields)**:

1. **Create an agent per brand** in the ElevenLabs dashboard (or via API): system prompt from
   section 7, first message = greeting, voice, language English (Australia if offered), LLM
   choice (Claude if available).
2. **Add tools:** connect your MCP server URL with the bridge secret header if MCP is
   supported; otherwise define server (webhook) tools that call your endpoints.
3. **Per-call DID:** the MCP servers need `x-bmspro-did`. Use one agent per DID group, or use
   the platform's dynamic variables / conversation initiation webhook to pass the dialed
   number to tools. Never let the caller supply it.
4. **Telephony:** connect a SIP trunk from Yeastar to ElevenLabs (they support SIP trunk
   integrations), and assign numbers to agents.
5. **Transfer:** configure their transfer-to-number / SIP transfer feature to your staff
   destination.
6. **Post-call:** use their post-call webhook to send transcripts and outcomes to
   `/api/ai/agent-activity`, then run the background agents (section 8).

| Pros | Cons |
|---|---|
| No worker to run | Less control over noise, turn detection and latency tuning |
| Best voices | Per-minute pricing; vendor lock-in |
| Built-in analytics | Per-DID tenant passing needs care |

---

## 13. Alternative B: Google speech-to-text in the pipeline

Swap only the STT line in `agent.py` **(check plugin name and options)**:

```python
from livekit.plugins import google

stt = google.STT(
    languages="en-AU",
    model="telephony",           # or the current recommended model for phone audio
    interim_results=True,
    # keywords / phrase hints for service names, car makes, suburbs if supported
)
```

Credentials: a Google Cloud service account with Speech-to-Text enabled
(`GOOGLE_APPLICATION_CREDENTIALS` path to the JSON key).

Notes:

- Google streams have a maximum duration; the plugin should restart streams on long calls.
  Test a 10-minute call.
- Compare against Deepgram on the same 10 test calls before deciding: measure phone-number
  and registration accuracy, and STT latency.
- Google TTS (`google.TTS`) is also available if you want one vendor; ElevenLabs will usually
  sound more natural.

---

## 14. Alternative C: keep OpenAI Live

If you stay on the current pilot path, apply in order:

1. E8 verify model names and endpoints.
2. E6 noise reduction, turn detection, language.
3. E2 reject on failure.
4. E5 tool timeouts.
5. E3/E4 socket reconnect and ordering.
6. E1 trusted DID routing.

All details in [ai-errors-and-improvements.md](ai-errors-and-improvements.md).

---

## 15. Go-live checklist

### Accounts and config

- [ ] LiveKit project, Deepgram, ElevenLabs, Anthropic accounts created (staging + production)
- [ ] Secrets stored in the secret manager
- [ ] Bridge secret shared between backend and worker; onboarding secret separate

### Backend

- [ ] `/api/ai/voice/profile` route with bridge auth
- [ ] `AI_VOICE_PROVIDER` accepts `livekit`
- [ ] Onboarding call id passed through profile headers
- [ ] E7 email decision made; E11 fixed
- [ ] Background agents (summary, QA) with tables and RLS
- [ ] Activity route accepts the new event types

### Telephony

- [ ] LiveKit inbound trunk restricted by IP and credentials
- [ ] Dispatch rule → `bmspro-receptionist`
- [ ] Yeastar trunk, wideband codec, inbound routes
- [ ] **Yeastar failover tested** (worker stopped → caller reaches staff)
- [ ] **Transfer tested** (REFER reaches the staff extension)

### Worker

- [ ] Profile fetched from dialed number; dev fallback disabled in production
- [ ] Noise cancellation, VAD, turn detection on
- [ ] MCP tools reachable with correct headers
- [ ] Greeting, filler, max call duration
- [ ] Telemetry events arriving
- [ ] Two or more workers in production

### Quality

- [ ] All 10 call scripts pass on a real phone line
- [ ] Latency and accuracy targets in section 10.3 met
- [ ] Voice chosen by listening on a real phone
- [ ] QA scores reviewed for the first 50 live calls
- [ ] Transcript retention decision made (notice, retention period, access)
