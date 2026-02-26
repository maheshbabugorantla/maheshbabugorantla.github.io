---
title: "From Span Hacks to Ingest Pipelines: Server-Side LLM Cost Enrichment with Elastic APM"
date: 2026-02-22T12:00:00-06:00
draft: false
tags: ["llm", "observability", "opentelemetry", "elasticsearch", "apm", "python", "openllmetry", "ingest-pipeline"]
description: "Replace the CostEnrichingSpanExporter with an Elasticsearch enrich pipeline: centralized pricing, retroactive corrections, zero SDK coupling."
ShowToc: true
TocOpen: true
---

In my [last post](/posts/monitoring-llm-usage-elastic-apm-openllmetry/), I showed a `CostEnrichingSpanExporter` that injects cost data into LLM spans. It works. But it mutates `span._attributes`, a private API that violates the OpenTelemetry spec. The `ReadableSpan` contract says spans are immutable after `on_end()`. The Python SDK's `_attributes` happens to be a writable `BoundedAttributes` dict, but that's an implementation detail, not a contract. [GitHub issue #4424](https://github.com/open-telemetry/opentelemetry-python/issues/4424) explicitly requests hooks for this use case and confirms the gap.

What if cost enrichment happened in Elasticsearch, not in Python?

The [Enrich Processor](https://www.elastic.co/docs/reference/enrich-processor/enrich-processor) does exactly this: it performs a lookup join against a pricing index at ingest time, before the document is written. No span mutation, no SDK coupling, no redeployments when pricing changes. This post walks through the complete setup: a pricing index, an enrich policy, an ingest pipeline wired into `traces-apm@custom`, and the operational lifecycle for keeping prices current.

---

## 1. Why Server-Side Enrichment

![Before vs After — client-side enrichment vs server-side pipeline](/images/server-side-llm-cost-enrichment/before-after-comparison.png)

Before diving into the implementation, the tradeoff table below convinced me to make the switch:

| Factor | Client-Side (`CostEnrichingSpanExporter`) | Server-Side (Ingest Pipeline) |
|--------|------------------------------------------|-------------------------------|
| Span immutability | Violates `ReadableSpan` contract via private `_attributes` | No span mutation — enrichment happens in Elasticsearch |
| SDK version coupling | Breaks if `BoundedAttributes` internals change | Zero SDK dependency |
| Pricing updates | Requires redeploying all application services | Update source index + re-execute enrich policy |
| Retroactive cost fixes | Impossible — cost is baked in at export time | `_update_by_query` with the pipeline re-processes historical docs |
| Multi-language support | Must reimplement for every OTel SDK language | Works for any SDK sending to Elastic APM |
| Operational complexity | Simple Python, no ES config needed | Enrich policy + pipeline + scheduled re-execution |
| Latency impact | Microseconds at export time | Milliseconds at ingest time |
| Debugging | Print statements in Python | `_simulate` API with `?verbose` |

The server-side approach is better for any team where (a) pricing changes, (b) multiple services emit LLM traces, or (c) you ever need to correct historical cost data. The client-side approach from the original post is still fine for quick prototyping.

---

## 2. The Architecture

![Architecture — data flow with the ingest pipeline inserted](/images/server-side-llm-cost-enrichment/architecture-pipeline.png)

The data flow is the same as the [original post's architecture](/posts/monitoring-llm-usage-elastic-apm-openllmetry/#3-the-architecture) (Flask App → OpenLLMetry SDK → OTel Collector → APM Server → Elasticsearch → Kibana), with one addition: an **ingest pipeline** sits between APM Server and Elasticsearch, performing a pricing lookup before the document is indexed.

Three components make this work:

1. **Pricing source index** (`llm-pricing`): stores per-model token pricing as regular Elasticsearch documents.
2. **Enrich policy** (`llm-pricing-policy`): creates a read-only, force-merged lookup index from the source. This is what the pipeline queries at ingest time.
3. **Ingest pipeline** (`enrich-llm-costs`): wired into [`traces-apm@custom`](https://www.elastic.co/docs/solutions/observability/apm/parse-data-using-ingest-pipelines), the official extension point for APM traces. It builds a composite key from provider + model, looks up pricing, calculates cost, and writes the result to `numeric_labels.*`.

The beauty of this design is that the application code doesn't change at all. OpenLLMetry already emits token counts. Elasticsearch handles the rest.

---

## 3. Step 1 — The Pricing Index

The pricing index is a plain Elasticsearch index with one document per model:

```json
PUT /llm-pricing
{
  "mappings": {
    "properties": {
      "model_id":                        { "type": "keyword" },
      "provider":                        { "type": "keyword" },
      "model_name":                      { "type": "keyword" },
      "input_price_per_million_tokens":  { "type": "scaled_float", "scaling_factor": 10000 },
      "output_price_per_million_tokens": { "type": "scaled_float", "scaling_factor": 10000 },
      "effective_date":                  { "type": "date" },
      "is_current":                      { "type": "boolean" }
    }
  }
}
```

A few design decisions worth explaining:

- **`model_id` is a composite key**: `"openai::gpt-4o"`. This avoids ambiguity when different providers have similarly named models.
- **`keyword` type is mandatory** for the match field. The enrich processor uses a `term` query internally. A `text` field will silently fail to match. This is the number-one gotcha I see in forum posts.
- **`scaled_float` for pricing** avoids floating-point precision issues in aggregations. With `scaling_factor: 10000`, you get four decimal places of precision. More than enough for token pricing.
- **`is_current` + `effective_date`** enable versioned pricing. When a price changes, set the old doc's `is_current` to `false` and index a new doc with `is_current: true`. The enrich policy's query filter ensures only current prices are used in lookups.

The [LiteLLM pricing database](https://github.com/BerriAI/litellm) (the same source the original post's `LiteLLMPricingDatabase` class uses) can seed this index. Export what you need and bulk-index it.

Sample data for four models:

```json
POST /llm-pricing/_bulk
{"index": {"_id": "openai::gpt-4o"}}
{"model_id": "openai::gpt-4o", "provider": "openai", "model_name": "gpt-4o", "input_price_per_million_tokens": 2.50, "output_price_per_million_tokens": 10.00, "effective_date": "2025-01-01", "is_current": true}
{"index": {"_id": "openai::gpt-4o-mini"}}
{"model_id": "openai::gpt-4o-mini", "provider": "openai", "model_name": "gpt-4o-mini", "input_price_per_million_tokens": 0.15, "output_price_per_million_tokens": 0.60, "effective_date": "2025-01-01", "is_current": true}
{"index": {"_id": "anthropic::claude-sonnet-4-20250514"}}
{"model_id": "anthropic::claude-sonnet-4-20250514", "provider": "anthropic", "model_name": "claude-sonnet-4-20250514", "input_price_per_million_tokens": 3.00, "output_price_per_million_tokens": 15.00, "effective_date": "2025-01-01", "is_current": true}
{"index": {"_id": "anthropic::claude-haiku-4-5-20251001"}}
{"model_id": "anthropic::claude-haiku-4-5-20251001", "provider": "anthropic", "model_name": "claude-haiku-4-5-20251001", "input_price_per_million_tokens": 0.80, "output_price_per_million_tokens": 4.00, "effective_date": "2025-01-01", "is_current": true}
```

> **Tip:** Use `_id` matching the `model_id` value so you can upsert pricing updates with a simple `PUT /llm-pricing/_doc/openai::gpt-4o`.

---

## 4. Step 2 — The Enrich Policy

The enrich policy tells Elasticsearch how to build the lookup index:

```json
PUT /_enrich/policy/llm-pricing-policy
{
  "match": {
    "indices": "llm-pricing",
    "match_field": "model_id",
    "enrich_fields": [
      "provider", "model_name",
      "input_price_per_million_tokens",
      "output_price_per_million_tokens",
      "effective_date"
    ],
    "query": {
      "term": { "is_current": true }
    }
  }
}
```

Then execute it to build the lookup index:

```
POST /_enrich/policy/llm-pricing-policy/_execute
```

**What happens under the hood**: Execution creates a `.enrich-llm-pricing-policy-<timestamp>` system index: a force-merged, single-segment, read-only index optimized for fast `term` lookups. The old `.enrich-*` index stays active until the new one is ready (no downtime during re-execution). Cleanup of old `.enrich-*` indices runs every 15 minutes by default.

> **Note:** Enrich policies are **immutable**. To change the field list or match field, you must delete the policy (`DELETE /_enrich/policy/llm-pricing-policy`) and recreate it. Updating the source data and re-executing is fine. Only structural changes require deletion.

Two other things to know:

- The `query` filter is optional but recommended for versioned pricing. Without it, every document in the source index would be included in the lookup, and you'd get unpredictable results when multiple price versions exist for the same model.
- `max_matches` defaults to 1, which returns an object. Setting it >1 returns an array. For pricing lookups, 1 is correct.

---

## 5. Step 3 — The Ingest Pipeline

![Enrich Processor Flow — step-by-step pipeline internals](/images/server-side-llm-cost-enrichment/enrich-processor-flow.png)

This is the core of the setup. Before showing the pipeline, two things you need to know about how Elastic APM stores OpenTelemetry attributes:

**The dot-to-underscore conversion.** OpenTelemetry attributes like `gen_ai.usage.prompt_tokens` are stored in Elasticsearch as `numeric_labels.gen_ai_usage_prompt_tokens` (if numeric) or `labels.gen_ai_usage_prompt_tokens` (if string). Dots become underscores. This conversion happens in the default APM pipeline *before* `@custom` runs, so the underscore form is what's available in our pipeline. See the [Elastic APM OTel attributes docs](https://www.elastic.co/docs/solutions/observability/apm/opentelemetry/attributes).

**The OpenTelemetry semantic convention rename.** As of OTel semconv v1.38.0, `gen_ai.system` is deprecated in favor of `gen_ai.provider.name`, and `gen_ai.usage.prompt_tokens` / `gen_ai.usage.completion_tokens` are deprecated in favor of `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`. [OpenLLMetry still emits the older names](https://github.com/traceloop/openllmetry/issues/3515) as of early 2026. The pipeline handles both.

The complete pipeline:

```json
PUT _ingest/pipeline/enrich-llm-costs
{
  "description": "Look up LLM model pricing and calculate per-span costs",
  "processors": [
    {
      "set": {
        "tag": "build-model-id",
        "description": "Build composite lookup key from provider + model",
        "if": """
          (ctx?.labels?.gen_ai_system != null || ctx?.labels?.gen_ai_provider_name != null) &&
          ctx?.labels?.gen_ai_request_model != null
        """,
        "field": "_temp_model_id",
        "value": "{{labels.gen_ai_system}}::{{labels.gen_ai_request_model}}",
        "override": true
      }
    },
    {
      "set": {
        "tag": "build-model-id-new-convention",
        "description": "Handle newer gen_ai.provider.name convention",
        "if": "ctx?._temp_model_id == null && ctx?.labels?.gen_ai_provider_name != null && ctx?.labels?.gen_ai_request_model != null",
        "field": "_temp_model_id",
        "value": "{{labels.gen_ai_provider_name}}::{{labels.gen_ai_request_model}}",
        "override": true
      }
    },
    {
      "enrich": {
        "tag": "lookup-pricing",
        "description": "Look up per-token pricing from the llm-pricing index",
        "policy_name": "llm-pricing-policy",
        "field": "_temp_model_id",
        "target_field": "_pricing",
        "max_matches": 1,
        "ignore_missing": true,
        "ignore_failure": true
      }
    },
    {
      "set": {
        "tag": "flag-missing-pricing",
        "description": "Flag spans where no pricing data was found",
        "if": "ctx?._temp_model_id != null && ctx?._pricing == null",
        "field": "labels.gen_ai_pricing_status",
        "value": "not_found"
      }
    },
    {
      "script": {
        "tag": "calculate-cost",
        "description": "Calculate input, output, and total cost from token counts and pricing",
        "if": "ctx?._pricing != null",
        "lang": "painless",
        "source": """
          // Helper: extract token count from numeric_labels (preferred) or labels (fallback)
          double getTokens(def ctx, String fieldName) {
            if (ctx.numeric_labels != null && ctx.numeric_labels.containsKey(fieldName)) {
              return ((Number) ctx.numeric_labels[fieldName]).doubleValue();
            }
            if (ctx.labels != null && ctx.labels.containsKey(fieldName)) {
              try {
                return Double.parseDouble(ctx.labels[fieldName].toString());
              } catch (NumberFormatException e) {
                return 0.0;
              }
            }
            return 0.0;
          }

          // Handle both old (prompt_tokens/completion_tokens) and new (input_tokens/output_tokens) conventions
          double promptTokens = getTokens(ctx, 'gen_ai_usage_prompt_tokens');
          if (promptTokens == 0.0) {
            promptTokens = getTokens(ctx, 'gen_ai_usage_input_tokens');
          }

          double completionTokens = getTokens(ctx, 'gen_ai_usage_completion_tokens');
          if (completionTokens == 0.0) {
            completionTokens = getTokens(ctx, 'gen_ai_usage_output_tokens');
          }

          // Get pricing from the enrich lookup
          double inputPrice = ((Number) ctx._pricing.input_price_per_million_tokens).doubleValue();
          double outputPrice = ((Number) ctx._pricing.output_price_per_million_tokens).doubleValue();

          // Calculate costs
          double inputCost = promptTokens * inputPrice / 1_000_000.0;
          double outputCost = completionTokens * outputPrice / 1_000_000.0;
          double totalCost = inputCost + outputCost;

          // Write to numeric_labels so Kibana can aggregate numerically
          if (ctx.numeric_labels == null) { ctx.numeric_labels = new HashMap(); }
          ctx.numeric_labels.put('gen_ai_usage_cost_input', inputCost);
          ctx.numeric_labels.put('gen_ai_usage_cost_output', outputCost);
          ctx.numeric_labels.put('gen_ai_usage_cost_total', totalCost);

          // Write pricing status to labels
          if (ctx.labels == null) { ctx.labels = new HashMap(); }
          ctx.labels.put('gen_ai_pricing_status', 'enriched');
          ctx.labels.put('gen_ai_pricing_model_resolved', ctx._pricing.model_name);
        """,
        "on_failure": [
          {
            "set": {
              "field": "labels.gen_ai_pricing_status",
              "value": "error"
            }
          },
          {
            "set": {
              "field": "labels.gen_ai_pricing_error",
              "value": "{{_ingest.on_failure_message}}"
            }
          }
        ]
      }
    },
    {
      "remove": {
        "tag": "cleanup-temp-fields",
        "description": "Remove temporary fields used during enrichment",
        "field": ["_temp_model_id", "_pricing"],
        "ignore_missing": true
      }
    }
  ]
}
```

Then wire it into the APM custom pipeline:

```json
PUT _ingest/pipeline/traces-apm@custom
{
  "description": "Custom processing for APM traces: LLM cost enrichment",
  "processors": [
    {
      "pipeline": {
        "name": "enrich-llm-costs",
        "if": "ctx?.labels?.gen_ai_system != null || ctx?.labels?.gen_ai_provider_name != null",
        "ignore_failure": true
      }
    }
  ]
}
```

The `if` condition is a performance guard. The cost pipeline only fires for LLM spans (those with a `gen_ai.system` or `gen_ai.provider.name` attribute). All other APM traces pass through untouched.

> **Production safety:** If you're on Elastic **8.12.0**, the `traces-apm@custom` pipeline is invoked twice due to a naming collision between `${type}-${package}@custom` and `${type}-${dataset}@custom`. This is fixed in **8.12.1**. See [Kibana #175254](https://github.com/elastic/kibana/issues/175254). The double invocation won't corrupt data (costs are recalculated, not accumulated), but it wastes resources. Upgrade if you can.

A few Painless scripting notes for anyone modifying the script:

- `((Number) nVal).doubleValue()`: `numeric_labels` values arrive as boxed Java numbers (could be `Long`, `Integer`, or `Double`). Casting to `Number` first handles all cases.
- `Double.parseDouble()` is needed for string-typed tokens that land in `labels.*` instead of `numeric_labels.*`.
- The `?.` null-safe operator prevents NPE when navigating nested maps, but **method calls on null-safe results are NOT safe**. `ctx.network?.name.equalsIgnoreCase('x')` throws NPE if `name` is null.
- The `on_failure` block captures errors per-span without failing the entire pipeline. You can query for `labels.gen_ai_pricing_status: "error"` in Kibana to find broken spans.

---

## 6. Testing with the Simulate API

Before deploying, test the pipeline with the `_simulate` API. This hits the live `.enrich-*` index, so the policy must be created and executed first.

```json
POST _ingest/pipeline/enrich-llm-costs/_simulate?verbose
{
  "docs": [
    {
      "_index": "traces-apm-default",
      "_source": {
        "labels": {
          "gen_ai_system": "openai",
          "gen_ai_request_model": "gpt-4o"
        },
        "numeric_labels": {
          "gen_ai_usage_prompt_tokens": 1500,
          "gen_ai_usage_completion_tokens": 500
        }
      }
    },
    {
      "_index": "traces-apm-default",
      "_source": {
        "labels": {
          "gen_ai_system": "anthropic",
          "gen_ai_request_model": "claude-sonnet-4-20250514"
        },
        "numeric_labels": {
          "gen_ai_usage_prompt_tokens": 800,
          "gen_ai_usage_completion_tokens": 1200
        }
      }
    },
    {
      "_index": "traces-apm-default",
      "_source": {
        "labels": {
          "gen_ai_system": "openai",
          "gen_ai_request_model": "unknown-model-xyz"
        },
        "numeric_labels": {
          "gen_ai_usage_prompt_tokens": 100,
          "gen_ai_usage_completion_tokens": 50
        }
      }
    },
    {
      "_index": "traces-apm-default",
      "_source": {
        "span": {
          "type": "db",
          "subtype": "postgresql"
        }
      }
    }
  ]
}
```

Each test doc validates a different scenario:

1. **OpenAI GPT-4o** (happy path). Should calculate: input cost = 1500 × $2.50/1M = $0.00375, output cost = 500 × $10.00/1M = $0.005, total = $0.00875.
2. **Anthropic Claude** (cross-provider lookup). Verifies the composite key `anthropic::claude-sonnet-4-20250514` resolves correctly.
3. **Unknown model**: should get `gen_ai_pricing_status: "not_found"`, no crash, no cost fields. This is your signal to add the model to the pricing index.
4. **Non-LLM span** (a PostgreSQL database span). Should pass through completely untouched, with no `_temp_model_id`, no `_pricing`, no cost fields.

> **Tip:** Elastic 8.12+ also offers `POST /_ingest/_simulate`, which can simulate the entire pipeline chain including default and final pipelines for a given data stream. Useful if you want to test the full `traces-apm@custom` wiring.

---

## 7. Updating Pricing

![Pricing Update Lifecycle — what happens when model pricing changes](/images/server-side-llm-cost-enrichment/pricing-update-lifecycle.png)

This is where the server-side approach really pays off. When model pricing changes:

**Step 1 — Update the source index:**

```json
// Mark old price as not current
POST /llm-pricing/_update/openai::gpt-4o
{ "doc": { "is_current": false } }

// Index new price
PUT /llm-pricing/_doc/openai::gpt-4o-2026-02
{
  "model_id": "openai::gpt-4o",
  "provider": "openai",
  "model_name": "gpt-4o",
  "input_price_per_million_tokens": 2.00,
  "output_price_per_million_tokens": 8.00,
  "effective_date": "2026-02-01",
  "is_current": true
}
```

**Step 2 — Re-execute the policy:**

```
POST /_enrich/policy/llm-pricing-policy/_execute
```

**Step 3** — Future documents use the new pricing immediately. No redeployment needed.

### Retroactive Corrections

This is the feature that's impossible with client-side enrichment. If you discover that pricing was wrong for the past month, you can re-process historical documents:

```json
POST traces-apm-default/_update_by_query?pipeline=enrich-llm-costs
{
  "query": {
    "bool": {
      "must": [
        { "exists": { "field": "labels.gen_ai_system" } },
        { "range": { "@timestamp": { "gte": "2026-02-01" } } }
      ]
    }
  }
}
```

`_update_by_query` rewrites documents in place. On large indices this can be slow and resource-intensive. Use the `size` and `scroll_size` parameters to throttle, and consider running during off-peak hours.

### Automating Policy Re-Execution

There's no built-in scheduling for enrich policy re-execution. [GitHub issue elastic/elasticsearch#50071](https://github.com/elastic/elasticsearch/issues/50071) is still open. Your options:

- **Cron job** (recommended for most teams): `curl -X POST "https://es-host:9200/_enrich/policy/llm-pricing-policy/_execute"` on a daily or weekly schedule.
- **Elasticsearch Watcher**: works but requires configuring auth in the Watcher action.
- **CI/CD trigger**: re-execute as part of a pricing update deployment script. Good for teams that already manage pricing in version control.

---

## 8. What Changes in Your Application Code

This is the payoff.

**Before** (from the [original post](/posts/monitoring-llm-usage-elastic-apm-openllmetry/#8-the-cost-enrichment-layer)):

```python
from traceloop.sdk import Traceloop
from llm_cost_injector import inject_llm_cost_tracking

Traceloop.init(app_name="recipe-generator-service", ...)
inject_llm_cost_tracking()  # Wraps the exporter, loads pricing
```

**After:**

```python
from traceloop.sdk import Traceloop

Traceloop.init(app_name="recipe-generator-service", ...)
# That's it. Cost enrichment happens in Elasticsearch.
```

The entire `llm_cost_injector.py` file (200+ lines), the `LiteLLMPricingDatabase` class, and the exporter wrapping logic are **all deleted**. The application emits token counts (which OpenLLMetry does automatically), and Elasticsearch handles the rest.

If you have multiple services in different languages (a Python backend, a Node.js gateway, a Java batch processor), they all get cost enrichment for free. No per-language reimplementation.

---

## 9. Dashboard Compatibility

If your existing dashboards query `numeric_labels.gen_ai_cost_total_usd` (the field name from the original post's `CostEnrichingSpanExporter`), you'll need to update the field references. The ingest pipeline writes to slightly different field names:

| Original Post (Client-Side) | This Post (Server-Side) |
|---|---|
| `numeric_labels.gen_ai_cost_total_usd` | `numeric_labels.gen_ai_usage_cost_total` |
| `numeric_labels.gen_ai_cost_input_usd` | `numeric_labels.gen_ai_usage_cost_input` |
| `numeric_labels.gen_ai_cost_output_usd` | `numeric_labels.gen_ai_usage_cost_output` |
| `labels.gen_ai_cost_model_resolved` | `labels.gen_ai_pricing_model_resolved` |
| N/A | `labels.gen_ai_pricing_status` |

Update your Kibana Lens formulas accordingly:

- **Total spend**: `sum(numeric_labels.gen_ai_usage_cost_total)`
- **Input cost**: `sum(numeric_labels.gen_ai_usage_cost_input)`
- **Output cost**: `sum(numeric_labels.gen_ai_usage_cost_output)`
- **Per-model breakdown**: split by `labels.gen_ai_request_model`
- **Missing pricing alert**: filter on `labels.gen_ai_pricing_status: "not_found"`

`numeric_labels.*` fields support numeric aggregations (sum, avg, percentiles) in Kibana Lens. Fields under `labels.*` only support term-based aggregations. This is why costs go into `numeric_labels` and status strings go into `labels`.

---

## 10. Putting It All Together

The end-to-end setup script below ties everything together. Save it and run it against your Elasticsearch cluster:

```bash
#!/bin/bash
# setup-llm-cost-pipeline.sh
# Sets up server-side LLM cost enrichment via Elasticsearch ingest pipelines.
# Requires: curl, a running Elasticsearch cluster.
# Usage: ES_HOST=http://localhost:9200 ES_AUTH=elastic:changeme ./setup-llm-cost-pipeline.sh

set -euo pipefail

ES_HOST="${ES_HOST:-http://localhost:9200}"
ES_AUTH="${ES_AUTH:-elastic:changeme}"

echo "=== LLM Cost Enrichment Pipeline Setup ==="
echo "Target: $ES_HOST"
echo ""

# 1. Create pricing index
echo "1/6 Creating pricing index..."
curl -sf -u "$ES_AUTH" -X PUT "$ES_HOST/llm-pricing" \
  -H 'Content-Type: application/json' -d '{
  "mappings": {
    "properties": {
      "model_id":                        { "type": "keyword" },
      "provider":                        { "type": "keyword" },
      "model_name":                      { "type": "keyword" },
      "input_price_per_million_tokens":  { "type": "scaled_float", "scaling_factor": 10000 },
      "output_price_per_million_tokens": { "type": "scaled_float", "scaling_factor": 10000 },
      "effective_date":                  { "type": "date" },
      "is_current":                      { "type": "boolean" }
    }
  }
}' && echo " OK" || echo " (already exists)"

# 2. Load pricing data
echo "2/6 Loading pricing data..."
curl -sf -u "$ES_AUTH" -X POST "$ES_HOST/llm-pricing/_bulk" \
  -H 'Content-Type: application/json' -d '
{"index": {"_id": "openai::gpt-4o"}}
{"model_id": "openai::gpt-4o", "provider": "openai", "model_name": "gpt-4o", "input_price_per_million_tokens": 2.50, "output_price_per_million_tokens": 10.00, "effective_date": "2025-01-01", "is_current": true}
{"index": {"_id": "openai::gpt-4o-mini"}}
{"model_id": "openai::gpt-4o-mini", "provider": "openai", "model_name": "gpt-4o-mini", "input_price_per_million_tokens": 0.15, "output_price_per_million_tokens": 0.60, "effective_date": "2025-01-01", "is_current": true}
{"index": {"_id": "anthropic::claude-sonnet-4-20250514"}}
{"model_id": "anthropic::claude-sonnet-4-20250514", "provider": "anthropic", "model_name": "claude-sonnet-4-20250514", "input_price_per_million_tokens": 3.00, "output_price_per_million_tokens": 15.00, "effective_date": "2025-01-01", "is_current": true}
{"index": {"_id": "anthropic::claude-haiku-4-5-20251001"}}
{"model_id": "anthropic::claude-haiku-4-5-20251001", "provider": "anthropic", "model_name": "claude-haiku-4-5-20251001", "input_price_per_million_tokens": 0.80, "output_price_per_million_tokens": 4.00, "effective_date": "2025-01-01", "is_current": true}
' && echo " OK"

# 3. Create enrich policy
echo "3/6 Creating enrich policy..."
curl -sf -u "$ES_AUTH" -X PUT "$ES_HOST/_enrich/policy/llm-pricing-policy" \
  -H 'Content-Type: application/json' -d '{
  "match": {
    "indices": "llm-pricing",
    "match_field": "model_id",
    "enrich_fields": [
      "provider", "model_name",
      "input_price_per_million_tokens",
      "output_price_per_million_tokens",
      "effective_date"
    ],
    "query": {
      "term": { "is_current": true }
    }
  }
}' && echo " OK"

# 4. Execute enrich policy
echo "4/6 Executing enrich policy (building lookup index)..."
curl -sf -u "$ES_AUTH" -X POST \
  "$ES_HOST/_enrich/policy/llm-pricing-policy/_execute" && echo " OK"

# 5. Create enrichment pipeline
echo "5/6 Creating enrichment pipeline..."
curl -sf -u "$ES_AUTH" -X PUT "$ES_HOST/_ingest/pipeline/enrich-llm-costs" \
  -H 'Content-Type: application/json' -d '{
  "description": "Look up LLM model pricing and calculate per-span costs",
  "processors": [
    {
      "set": {
        "tag": "build-model-id",
        "if": "(ctx?.labels?.gen_ai_system != null || ctx?.labels?.gen_ai_provider_name != null) && ctx?.labels?.gen_ai_request_model != null",
        "field": "_temp_model_id",
        "value": "{{labels.gen_ai_system}}::{{labels.gen_ai_request_model}}",
        "override": true
      }
    },
    {
      "set": {
        "tag": "build-model-id-new-convention",
        "if": "ctx?._temp_model_id == null && ctx?.labels?.gen_ai_provider_name != null && ctx?.labels?.gen_ai_request_model != null",
        "field": "_temp_model_id",
        "value": "{{labels.gen_ai_provider_name}}::{{labels.gen_ai_request_model}}",
        "override": true
      }
    },
    {
      "enrich": {
        "tag": "lookup-pricing",
        "policy_name": "llm-pricing-policy",
        "field": "_temp_model_id",
        "target_field": "_pricing",
        "max_matches": 1,
        "ignore_missing": true,
        "ignore_failure": true
      }
    },
    {
      "set": {
        "tag": "flag-missing-pricing",
        "if": "ctx?._temp_model_id != null && ctx?._pricing == null",
        "field": "labels.gen_ai_pricing_status",
        "value": "not_found"
      }
    },
    {
      "script": {
        "tag": "calculate-cost",
        "if": "ctx?._pricing != null",
        "lang": "painless",
        "source": "double getTokens(def ctx, String fieldName) { if (ctx.numeric_labels != null && ctx.numeric_labels.containsKey(fieldName)) { return ((Number) ctx.numeric_labels[fieldName]).doubleValue(); } if (ctx.labels != null && ctx.labels.containsKey(fieldName)) { try { return Double.parseDouble(ctx.labels[fieldName].toString()); } catch (NumberFormatException e) { return 0.0; } } return 0.0; } double promptTokens = getTokens(ctx, '"'"'gen_ai_usage_prompt_tokens'"'"'); if (promptTokens == 0.0) { promptTokens = getTokens(ctx, '"'"'gen_ai_usage_input_tokens'"'"'); } double completionTokens = getTokens(ctx, '"'"'gen_ai_usage_completion_tokens'"'"'); if (completionTokens == 0.0) { completionTokens = getTokens(ctx, '"'"'gen_ai_usage_output_tokens'"'"'); } double inputPrice = ((Number) ctx._pricing.input_price_per_million_tokens).doubleValue(); double outputPrice = ((Number) ctx._pricing.output_price_per_million_tokens).doubleValue(); double inputCost = promptTokens * inputPrice / 1000000.0; double outputCost = completionTokens * outputPrice / 1000000.0; double totalCost = inputCost + outputCost; if (ctx.numeric_labels == null) { ctx.numeric_labels = new HashMap(); } ctx.numeric_labels.put('"'"'gen_ai_usage_cost_input'"'"', inputCost); ctx.numeric_labels.put('"'"'gen_ai_usage_cost_output'"'"', outputCost); ctx.numeric_labels.put('"'"'gen_ai_usage_cost_total'"'"', totalCost); if (ctx.labels == null) { ctx.labels = new HashMap(); } ctx.labels.put('"'"'gen_ai_pricing_status'"'"', '"'"'enriched'"'"'); ctx.labels.put('"'"'gen_ai_pricing_model_resolved'"'"', ctx._pricing.model_name);",
        "on_failure": [
          { "set": { "field": "labels.gen_ai_pricing_status", "value": "error" } },
          { "set": { "field": "labels.gen_ai_pricing_error", "value": "{{_ingest.on_failure_message}}" } }
        ]
      }
    },
    {
      "remove": {
        "tag": "cleanup-temp-fields",
        "field": ["_temp_model_id", "_pricing"],
        "ignore_missing": true
      }
    }
  ]
}' && echo " OK"

# 6. Wire into APM custom pipeline
echo "6/6 Wiring into traces-apm@custom..."
curl -sf -u "$ES_AUTH" -X PUT "$ES_HOST/_ingest/pipeline/traces-apm@custom" \
  -H 'Content-Type: application/json' -d '{
  "description": "Custom processing for APM traces: LLM cost enrichment",
  "processors": [
    {
      "pipeline": {
        "name": "enrich-llm-costs",
        "if": "ctx?.labels?.gen_ai_system != null || ctx?.labels?.gen_ai_provider_name != null",
        "ignore_failure": true
      }
    }
  ]
}' && echo " OK"

echo ""
echo "=== Setup complete ==="
echo "LLM cost enrichment is now active for all APM traces."
echo "Test with: POST _ingest/pipeline/enrich-llm-costs/_simulate?verbose"
```

The setup script and all pipeline configs are available in the [companion repo](https://github.com/maheshbabugorantla/llm-observability-with-elasticapm) under `elasticsearch/`.

---

## Conclusion

We moved from ~200 lines of fragile Python (wrapping a private `_attributes` API, bundling a pricing database, redeploying to update prices) to ~50 lines of Elasticsearch configuration that handles all of it server-side.

The pricing index is your single source of truth. Update it once, re-execute the policy, and every service that emits LLM traces gets the new pricing automatically. If you discover a pricing error from last month, `_update_by_query` corrects the historical data. And OpenTelemetry spans stay immutable, exactly as the spec intended.

The tradeoff is real: you now have Elasticsearch infrastructure to manage (an enrich policy, a pipeline, a pricing index). For a team that already runs Elastic, this is a natural fit. For a quick prototype, the [client-side approach from the original post](/posts/monitoring-llm-usage-elastic-apm-openllmetry/#8-the-cost-enrichment-layer) is simpler.

> **Cost math vs invoice reality:** The same caveat applies. Token-based estimates can differ from provider billing due to system prompts, cached tokens, tool call overhead, tiered pricing, and rounding. Treat this as an allocation and monitoring signal, not a perfect invoice replica.

Check out the [companion repo](https://github.com/maheshbabugorantla/llm-observability-with-elasticapm) for the full source code, and the [original post](/posts/monitoring-llm-usage-elastic-apm-openllmetry/) for the end-to-end monitoring setup this builds on.
