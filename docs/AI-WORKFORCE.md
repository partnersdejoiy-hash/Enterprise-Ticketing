# OrbitDesk AI workforce

Two labelled AI worker records are provisioned for every department (triage/review and response drafting), plus one superadmin PA. Names start blank for the owner to choose. These are NOT login accounts and never inherit employee/admin permissions.

## Activate OpenRouter free inference

1. Create an OpenRouter account/key under your own account. Do not commit or paste keys into chat.
2. Set `OPENROUTER_API_KEY` as a sensitive **server-only Production** environment variable on the OrbitDesk Vercel project, then rebuild Production.
3. Superadmin: Settings → AI workforce. Default `qwen/qwen3.8-27b:free` is a free open-weight Qwen variant checked against OpenRouter's catalog on 2026-09-29. Availability changes; replace with another verified open-source/open-weight `:free` model if necessary.
4. Test connection. After success, enable server AI and Save AI settings. The probe expires after one hour.
5. Choose names and enable/disable each worker; Save worker. Run a synthetic ticket through both workers and verify staff-only drafts.

The adapter rejects paid model IDs and sets zero prompt/completion maximum prices, with no model fallback or paid plugins. The app uses a shared cap (default 40 requests/UTC day, maximum 50, 15/minute). Connection tests, PA briefs, chats and worker calls all consume it, including failed attempts. Provider/account limits also apply. Free inference does not guarantee 24/7 availability. Buying credits/top-ups is not automated.

## Self-hosted Ollama alternative

Operate an Ollama server continuously on hardware you control. Protect it behind authenticated HTTPS, install your chosen licensed model, and expose its OpenAI-compatible `/v1` endpoint. Set `ORBIT_OLLAMA_URL=https://your-server.example/v1` and `ORBIT_OLLAMA_TOKEN` in Vercel, choose Ollama/model in settings, test and save. The endpoint can only come from a server environment variable, not an HTTP request. Vercel does not run the model; compute, power and network are not inherently free. Neither a server nor an API key is provisioned by this code.

## Execution and PA

Ticket automation events enqueue both enabled department workers. A context/config/worker revision key deduplicates jobs. PostgreSQL leases use `FOR UPDATE SKIP LOCKED`; batches process two jobs, each with an 18-second provider timeout. Vercel `waitUntil` preserves event work within the 30-second function duration. Jobs survive invocations; expired leases can retry (up to three attempts). A superadmin can Process pending work, including failed jobs after a one-minute cooldown. No cron or permanent background daemon is configured. An exhausted lease at three attempts requires operator investigation; provider calls are not guaranteed exactly-once if an invocation dies.

The PA's factual report aggregates queues, unassigned work, SLA flags and AI outcomes per department. Generate PA briefing requests a reviewable LLM summary of those counts. It does not autonomously delegate privileged operations or send reports by email. Existing deterministic ticket assignment still works independently of AI.

Disabling a worker cancels queued/in-flight records. Output is checked again before publication. Changing provider configuration cancels earlier pending work. Historical drafts remain visible to authorized handlers with timestamps. Worker/config changes and PA reports are audited.

## Data and permissions

Automatic prompts contain ONLY department, status, priority and SLA flags. They exclude employee names, subjects/descriptions, comments, documents, tags and contact details. Thus drafts are generic workflow assistance, not case findings. Chat sends the explicitly entered question to the configured provider; UI instructs against entering private HR data or secrets. It has no access to ticket records. No tool calls execute LLM instructions.

Only superadmins configure names, providers, enablement, queue retries and PA generation. Admins can read workforce reports. Staff can read/run ticket drafts only if the existing ticket-access and handling checks both pass. Requesters cannot read internal AI results. Browser sessions, first-login changes and hierarchy authorization remain unchanged.

## Deployment and rollback

Apply additive `migrations/003_ai_workforce.sql` via `pnpm db:migrate` before releasing. No existing users/roles are changed. Global AI remains disabled by default until credentials and the connection test are complete. Rollback can disable global AI; tables/drafts need not be deleted. `tests/ai-workforce.test.ts` exercises authorization, non-disclosure, concurrent deduplication, persistence, cancellation and caps using a simulated provider. A passing test is not evidence of a live provider connection.

## Ollama Cloud and OpenCode Zen

All department workers and the PA use the saved workspace provider/model. Superadmins can select **Ollama Cloud** (server variable `OLLAMA_API_KEY`, suggested model `gemma4:31b`) or **OpenCode Zen** (`OPENCODE_API_KEY`). Endpoints are fixed to `https://ollama.com/v1/chat/completions` and `https://opencode.ai/inference/openai/v1/chat/completions`; keys never reach the browser. Self-hosted Ollama remains available.

OpenCode accepts only `longcat-2.5-preview-free`, `mimo-v2.5-free`, and `mimo-v2.6-flash-free`. No paid-model fallback is attempted. These are hosted offers, not a guarantee of permanent free availability or an open-source license for every model. MiMo free prompts may be used for improvement; no confidential or personal information should be entered into chat. Automatic worker prompts contain workflow metadata only. Ollama Cloud has account quotas; use its free plan and do not enable paid capacity without authorization. This application does not change provider billing settings.

After setting the chosen server key in Vercel, redeploy, select the provider/model, run **Test connection**, then enable and save. A model appearing in the selector does not mean inference is connected. Reference docs: https://docs.ollama.com/cloud and https://opencode.ai/docs/en/zen/ (checked 2026-09-30).

## Ticket deletion

Apply `004_ticket_deletion.sql` before this release. Authorized admins can delete website verification tickets as well as internal tickets. Deletion is transactional: comments, history, uploaded evidence and AI jobs are removed together. A minimal audit row retains the ticket reference, deleting actor and time. The intake receipt retains its request ID/hash/reference with a null ticket ID; replay returns HTTP 410 and cannot recreate the deleted ticket. Existing orphan records are not purged by the migration. Foreign keys enforce integrity for new writes.

Single and bulk delete now report server errors; bulk results retain failed selections and count only confirmed successes. Deletion remains permanent and requires the existing confirmation dialog. Regression tests use an isolated database, including an injected failure to prove rollback; no production ticket needs to be deleted to validate this change.

Provider cards show credential availability independently for OpenRouter, OpenCode, Ollama Cloud and self-hosted Ollama. A credential being saved is not a successful connection test. Each provider remembers its last saved model; its successful test is scoped to that provider and model, and expires after one hour. Switching requires test/enable/save and changes the workspace provider for all workers and the PA. It does not erase other provider credentials or settings. Only one provider runs at a time; there is no silent cross-provider fallback. OpenCode service account keys use its current Console inference endpoint (https://opencode.ai/v2/docs/console/inference).
