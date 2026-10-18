# The AxiomFlo gateway

The gateway is a separate Cloud Run service (`axiomflo-gateway`). It's built from the same code as the API. Tools and scripts send Claude requests to it with an **AxiomFlo key** instead of an Anthropic key. For each request, the gateway:

1. **Checks the key.** It is looked up by its hash. Then the owner's membership, status and team are checked again, on every request.
2. **Forwards the request** to Anthropic with the company's Anthropic key. Callers never see that key.
3. **Returns the answer unchanged.** Streamed answers pass through event by event.
4. **Writes one usage record** to `companies/{companyId}/usage/{requestId}`.

Status: built and tested against a pretend Anthropic server (R2). It is **not deployed yet**. Deploying it (R5) needs your approval, plus an Anthropic API key in Secret Manager.

## What a usage record holds

| Field | Meaning |
| --- | --- |
| `timestamp`, `latencyMs` | When the request started and how long it took |
| `principal.id`, `keyId` | Who made the request and with which of their keys |
| `teamId`, `teamCode` | The team the key belongs to, as it was at the time |
| `providerId`, `modelId` | `anthropic` and the model that answered |
| `inputTokens`, `outputTokens`, `cacheWriteTokens`, `cacheReadTokens` | Exactly what Anthropic reported. `null` if it reported nothing (for example, an error) |
| `requestStatus`, `providerStatus` | `succeeded` or `failed`, and Anthropic's HTTP status (`null` if it couldn't be reached) |
| `costStatus`, `estimatedCostUsd`, `priceVersion` | The cost worked out from list prices in `server/src/gateway/prices.ts`. A model with no listed price is `unavailable`, with no cost. It is never counted as zero |
| `stream`, `providerRequestId` | Whether the answer was streamed, and Anthropic's request ID for matching their logs |

**Never stored or logged:** prompts, answers, AxiomFlo keys or the Anthropic key.

## Answers to expect

The gateway's own errors use Anthropic's error shape, so SDKs display them normally:

| Status | When |
| --- | --- |
| `401 authentication_error` | No key, or an unknown, revoked or malformed key |
| `403 permission_error` | The key is real, but its owner is suspended, has left the key's team, or the company is inactive |
| `400 invalid_request_error` | Body isn't JSON, or has no `model` |
| `429 rate_limit_error` | More than 60 requests a minute with one key |
| `502 api_error` | Anthropic couldn't be reached |
| `503 api_error` | The key couldn't be checked (database unavailable). Access is never granted on an error |

Anthropic's own errors, such as its rate limits or a bad model name, pass through unchanged and are recorded as `failed`.

## Pointing a tool at it (after deployment)

Anthropic SDKs and most tools let you change the base URL. For example:

```bash
export ANTHROPIC_BASE_URL="https://<gateway address>/anthropic"
export ANTHROPIC_API_KEY="axf_..."   # your AxiomFlo key from the workspace
```

```bash
curl "$ANTHROPIC_BASE_URL/v1/messages" \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-haiku-5-5","max_tokens":50,"messages":[{"role":"user","content":"Say hello"}]}'
```

Only `POST /v1/messages` is forwarded for now. Other Anthropic endpoints return 404.

## Limits to know

- The per-key limit is counted per gateway instance, so keep the gateway's maximum instances low.
- If writing a usage record fails after the answer has already gone back, the record is lost. A `usage record failed` line is logged with the request ID.
- Costs are estimates from list prices. Your Claude Console bill is the real figure.
