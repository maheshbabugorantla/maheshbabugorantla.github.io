---
title: "Monitoring LLM Usage with Elastic APM & OpenLLMetry"
date: 2026-02-15T12:00:00-06:00
draft: false
tags: ["llm", "observability", "opentelemetry", "elasticsearch", "apm", "python", "openllmetry"]
description: "From zero-code instrumentation to full observability — a hands-on guide to monitoring LLM cost, latency, and errors with Elastic APM and OpenLLMetry."
ShowToc: true
TocOpen: true
---

You shipped an LLM-powered feature. Users love it. Then the invoice arrives — and nobody can explain where $4,000 in API costs went last Tuesday. Sound familiar?

LLMs are black boxes in production. You can't see how many tokens each request burns, which model is slower, or why a batch job at 3 AM quietly retried thousands of failed completions and doubled your daily spend. Traditional APM tools are starting to add LLM support, though coverage and pricing vary — some bundle it in, others charge extra. Dedicated LLM observability platforms offer deeper insight out of the box, though many require a proprietary SDK or proxy that ties your instrumentation to a single vendor.

In this post, I'll walk you through building a full LLM monitoring stack using **open standards** — [OpenTelemetry](https://opentelemetry.io/), [OpenLLMetry](https://github.com/traceloop/openllmetry), and [Elastic APM](https://www.elastic.co/observability/application-performance-monitoring). By the end, you'll have cost tracking, latency metrics, error correlation, and multi-model comparison running in Kibana, all with vendor-neutral telemetry. Your backend is swappable (any OTLP-compatible system works), and the instrumentation uses open-source libraries — though switching away from OpenLLMetry's decorators would require code changes, just as with any instrumentation library.

---

## 1. OpenTelemetry in 60 Seconds

Before we talk about LLMs, let's ground ourselves in the observability standard that makes all of this possible.

![OpenTelemetry Basics — Traces, Spans, Exporters, Collectors](/images/monitoring-llm-usage/otel-basics.png)

OpenTelemetry (OTel) has four building blocks you need to know:

- **Traces** capture the full journey of a request through your system — from the HTTP endpoint down to the database query.
- **Spans** are individual operations within a trace. Each span has a name, duration, status, and arbitrary key-value attributes.
- **Exporters** ship your trace data out of the application, typically via the OTLP protocol.
- **Collectors** receive, process, and route telemetry data to your backend of choice — Elastic, Jaeger, Datadog, or anything that speaks OTLP.

Why does OTel matter for LLM apps? Because it's **vendor-neutral** and **composable**. You instrument once and send data anywhere. When your observability needs change (and they will), you swap the backend, not the instrumentation code.

---

## 2. Enter OpenLLMetry

So OpenTelemetry gives us the plumbing. But LLM calls have unique attributes — model names, token counts, prompt content, system identifiers — that standard OTel instrumentation doesn't capture. That's where [OpenLLMetry](https://github.com/traceloop/openllmetry) comes in.

![How OpenTelemetry concepts map to OpenLLMetry](/images/monitoring-llm-usage/otel-to-openllmetry.png)

OpenLLMetry is Traceloop's open-source instrumentation layer built on top of OpenTelemetry. It maps cleanly to OTel's concepts:

| OTel Concept | OpenLLMetry Equivalent |
|---|---|
| Trace | `@workflow` decorator |
| Span | `@task` decorator |
| Attributes | Auto-captured `gen_ai.*` fields |
| Exporter | Same OTLP exporter — unchanged |

When you decorate a function with `@task`, OpenLLMetry automatically captures `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.system`, and more. No manual attribute setting required. The `@workflow` decorator creates a top-level span that groups related `@task` spans into a single trace hierarchy, giving you end-to-end visibility into multi-step LLM operations.

> **Note:** Some `gen_ai.*` attribute names are evolving as the semantic conventions mature — check the [latest spec](https://opentelemetry.io/docs/specs/semconv/gen-ai/) for current names.

> **Privacy note:** OpenLLMetry logs prompts, completions, and embeddings to span attributes by default. If your LLM calls process user data, set `TRACELOOP_TRACE_CONTENT=false` to disable content capture before deploying to production. See [Traceloop's privacy docs](https://www.traceloop.com/docs/openllmetry/privacy/traces) for selective per-workflow controls.

---

## 3. Before vs After: The Code

This is where the value becomes concrete. Let me show you what LLM instrumentation looks like with raw OpenTelemetry versus OpenLLMetry.

![Before vs After — manual instrumentation vs OpenLLMetry auto-instrumentation](/images/monitoring-llm-usage/before-after-comparison.png)

### The Hard Way: Manual OpenTelemetry

First, the setup boilerplate — ~10 lines before you write any business logic:

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

provider = TracerProvider()
processor = BatchSpanProcessor(OTLPSpanExporter(
    endpoint="http://otel-collector:4318/v1/traces"
))
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)
tracer = trace.get_tracer("recipe-service")
```

Then, every single LLM call function needs ~25 lines of manual instrumentation:

```python
def call_openai(prompt, model="gpt-4"):
    with tracer.start_as_current_span("call_openai") as span:
        span.set_attribute("gen_ai.system", "openai")
        span.set_attribute("gen_ai.request.model", model)
        span.set_attribute("gen_ai.request.temperature", 0.7)
        span.set_attribute("gen_ai.request.max_tokens", 2000)

        try:
            response = openai_client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7, max_tokens=2000
            )
            span.set_attribute("gen_ai.response.model", response.model)
            span.set_attribute("gen_ai.usage.input_tokens",
                               response.usage.prompt_tokens)
            span.set_attribute("gen_ai.usage.output_tokens",
                               response.usage.completion_tokens)
            span.set_status(StatusCode.OK)
            return response.choices[0].message.content
        except Exception as e:
            span.set_status(StatusCode.ERROR, str(e))
            span.record_exception(e)
            raise
```

That's 4 imports, manual provider/processor/exporter wiring, manual span creation, manual attribute setting for every `gen_ai` field, manual response capture, and manual error handling. **Repeat this for every LLM function in your codebase.**

### The Easy Way: OpenLLMetry

Setup — 2 imports, 1 function call:

```python
from traceloop.sdk import Traceloop
from traceloop.sdk.decorators import workflow, task

Traceloop.init(
    app_name="recipe-generator-service",
    api_endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT",
                           "http://otel-collector:4318"),
    disable_batch=False
)
```

And the business logic stays clean — just add decorators:

```python
@task(name="call_openai")
def call_openai(prompt, model="gpt-4", temperature=0.7):
    """All gen_ai.* attributes are captured automatically"""
    response = openai_client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": "You are an expert chef..."},
            {"role": "user", "content": prompt}
        ],
        temperature=temperature,
        max_tokens=2000
    )
    return {
        "recipe": response.choices[0].message.content,
        "model": response.model,
        "usage": {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens
        }
    }

@workflow(name="recipe_generation_workflow")
def generate_recipe(provider, dish_name, ...):
    prompt = generate_recipe_prompt(dish_name, ...)
    result = call_openai(prompt, model=model)
    return result
```

The key takeaway: **zero manual span or attribute management.** OpenLLMetry intercepts the OpenAI and Anthropic client libraries, captures all the `gen_ai.*` attributes automatically, and your functions contain nothing but business logic.

---

## 4. System Architecture

Here's the full pipeline from your Flask app to a Kibana dashboard.

![System Architecture — Flask to OpenLLMetry to OTel Collector to APM to ES to Kibana](/images/monitoring-llm-usage/architecture.png)

The stack has six components, all running in Docker Compose on a single bridge network:

1. **Flask App** — Your Python application, instrumented with OpenLLMetry decorators.
2. **OpenLLMetry SDK** — Auto-instruments OpenAI and Anthropic client libraries, captures `gen_ai.*` attributes, exports via OTLP/HTTP.
3. **OpenTelemetry Collector** — Receives OTLP/HTTP on port 4318, batches spans, applies memory limits, and routes to APM Server via OTLP/gRPC.
4. **APM Server** — Natively ingests OTLP trace data and indexes it into Elasticsearch.
5. **Elasticsearch** — Stores all trace data. The `gen_ai.*` span attributes land in Elasticsearch as `labels.gen_ai_*` fields (dots replaced with underscores), with numeric values accessible for aggregation.
6. **Kibana** — Provides the APM UI with service maps, trace waterfalls, and custom dashboards.

The data flow is straightforward: your app sends OTLP/HTTP to the Collector, which forwards OTLP/gRPC to APM Server, which writes to Elasticsearch. Kibana reads from Elasticsearch. No custom adapters, no proprietary protocols.

Here's the Docker Compose overview:

```yaml
services:
  elasticsearch:    # v8.11.0 — single node, 512MB heap
  kibana:           # v8.11.0 — connected to ES
  otel-collector:   # contrib v0.91.0 — OTLP receiver + APM exporter
  apm-server:       # v8.11.0 — OTLP to Elastic APM format
  flask-app:        # Python 3.11 — OpenLLMetry instrumented

networks:
  observability:
    driver: bridge
```

---

## 5. Building a Multi-Agent Workflow

A single LLM call is easy to monitor. The real challenge is multi-agent systems where multiple models collaborate, run in parallel, retry on failure, and feed each other's outputs. That's the scenario I built to put this stack through its paces.

![Multi-Agent Workflow — 4 AI agents: Coordinator, Chef, Sommelier, Nutritionist](/images/monitoring-llm-usage/multi-agent-workflow.png)

The **Restaurant Menu Designer** orchestrates 4 AI agents to create a complete fine-dining menu:

| Agent | Model | Role |
|-------|-------|------|
| **Menu Coordinator** | GPT (OpenAI) | Strategic planning — designs the course structure |
| **Executive Chef** | Claude (Anthropic) | Creative — generates detailed recipes for each course |
| **Nutritionist** | Claude Haiku (Anthropic) | Analytical — reviews nutritional compliance, approves or requests changes |
| **Sommelier** | GPT (OpenAI) | Expert pairing — matches wines to each course |

The workflow runs in 5 phases:

1. **Coordinator plans** the menu structure (sequential)
2. **Parallel research** — Chef creates recipes, Nutritionist researches dietary guidelines, Sommelier develops a pairing strategy (concurrent via `ThreadPoolExecutor`)
3. **Recipe refinement** — Nutritionist reviews each recipe, Chef iterates based on feedback (nested workflow with retry logic, max 3 iterations)
4. **Wine pairing** — Sommelier pairs each course (includes automatic retry on incomplete results)
5. **Final assembly** — combine everything into the complete menu

```python
@workflow(name="restaurant_menu_design_workflow")
def design_restaurant_menu():
    # Phase 1: Coordinator plans (GPT)
    menu_plan = coordinator_plan_menu_structure(cuisine, ...)

    # Phase 2: Parallel execution (Chef + Nutritionist + Sommelier)
    research = parallel_agent_research(menu_plan, ...)

    # Phase 3: Refinement loop (Claude ↔ Claude Haiku)
    refined = refine_recipes_with_feedback(research["recipes"], ...)

    # Phase 4: Wine pairing (GPT, with retry)
    wines = pair_wines_with_courses(refined, ...)

    return final_menu
```

This creates a deeply nested trace with 15-20 spans: parallel execution branches, cross-model calls (GPT for planning, Claude for creativity), retry attempts visible as iteration counters, and the full agent-to-agent data flow. It's the perfect stress test for any APM system — and it renders beautifully in Kibana's waterfall view.

Context propagation to threads is handled automatically by the Traceloop SDK. `Traceloop.init()` activates OpenTelemetry's [`ThreadingInstrumentor`](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/threading/threading.html), which ensures that the current trace context is captured and re-attached in `ThreadPoolExecutor` worker threads. Spans created by `@task`-decorated functions running in the thread pool are correctly parented to the calling `@workflow` span — no manual `contextvars.copy_context()` needed.

---

## 6. What You Can Monitor

Once traces are flowing into Elastic APM, here's what you get out of the box.

![What We Can Monitor — Token usage, latency, cost, errors, multi-model comparison, traces, prompts, alerts](/images/monitoring-llm-usage/monitoring-cards.png)

Eight capabilities, each powered by the `gen_ai.*` attributes that OpenLLMetry captures automatically:

| Capability | What You See | Why It Matters |
|---|---|---|
| **Token Usage** | Input/output tokens per call, per model | Optimize prompts, catch token inflation |
| **Latency** | Response time (avg, P95) per model and endpoint | SLA monitoring, provider comparison |
| **Cost Tracking** | Dollar cost per call, per workflow, per model | Budget control, cost allocation |
| **Error Detection** | Failed LLM calls with stack traces and retry counts | Reliability monitoring, root cause analysis |
| **Multi-Model Comparison** | Side-by-side metrics across GPT, Claude, etc. | Informed model selection |
| **Trace Correlation** | Full request path from HTTP endpoint to LLM call | Debug complex multi-agent workflows |
| **Prompt Logging** | System/user prompts and completions stored in span attributes | Audit trail, prompt debugging |
| **Alerts** | Kibana alerting rules on any metric | Token budget alerts, latency spikes, error rate thresholds |

In the Kibana APM UI, you can explore these through the **service map** (see your app's dependencies on LLM providers), **trace waterfall** (drill into individual requests), and **span metadata** (inspect every `gen_ai.*` attribute on each LLM call).

---

## 7. The Dashboard

All of this data is great in the APM trace view, but for day-to-day monitoring you want a dashboard. I built an 8-panel Kibana Lens dashboard that gives you the full LLM observability picture at a glance.

![LLM Observability Dashboard — 8 panels showing cost, tokens, latency, and error metrics across models](/images/monitoring-llm-usage/live-metrics-dashboard-preview.png)

The dashboard is organized in three rows:

**Row 1 — Cost Analysis:**
- **Cost Distribution by Model** — Donut chart showing what percentage of your total spend goes to each model
- **Cost per Call by Model** — Metric tiles showing average cost per LLM call (e.g., GPT-4 $0.025 vs Claude $0.012)
- **Cost over Time** — Line chart tracking spending trends per model

**Row 2 — Token Usage:**
- **Token Usage by Model** — Stacked bar showing total input + output tokens per model
- **Input vs Output Token Ratio** — Average input vs output tokens per call — helps you spot verbose prompts
- **Total Tokens by Model** — Compare with cost distribution to identify the most token-efficient models

**Row 3 — Latency & Reliability:**
- **Response Latency by Model** — Average and P95 latency per model (sourced from `span.duration.us`)
- **Error Rates by Model** — Success vs failure outcomes per model

The dashboard is defined as Kibana saved objects in NDJSON format. To import it:

```bash
curl -X POST "http://localhost:5601/api/saved_objects/_import?overwrite=true" \
  -u elastic:changeme \
  -H "kbn-xsrf: true" \
  --form file=@kibana/llm-observability-dashboards.ndjson
```

---

## 8. Going Further: Automatic Cost Tracking

Here's the gap that motivated the most interesting piece of engineering in this project: **OpenLLMetry captures tokens but not dollar cost.** It knows you used 500 input tokens and 1200 output tokens on `claude-sonnet-4-5-20250929`, but it doesn't know what that costs.

### The Architecture

![LLM Cost Injection Architecture — how cost data flows from LiteLLM pricing through the span exporter](/images/monitoring-llm-usage/llm-cost-injection-architecture.png)

The solution is a custom `CostEnrichingSpanExporter` that wraps the real OTLP exporter, intercepting the export pipeline to inject cost attributes into LLM spans before they're sent to the backend. It works by mutating `span._attributes` in-place — a pragmatic tradeoff that bypasses the SDK's read-only span convention but avoids the complexity of rebuilding spans from scratch. Since `_attributes` is an internal implementation detail (not part of the public OTel API), pin your `opentelemetry-sdk` version and test after upgrades.

### How It Works

![Cost-Enriching Span Exporter — Decorator pattern intercepting LLM spans](/images/monitoring-llm-usage/cost-enriching-span-exporter.jpg)

The `CostEnrichingSpanExporter` implements the `SpanExporter` interface and wraps the original exporter:

```python
class CostEnrichingSpanExporter(SpanExporter):
    def __init__(self, wrapped_exporter, pricing_db):
        self.wrapped_exporter = wrapped_exporter
        self.pricing_db = pricing_db

    def export(self, spans):
        for span in spans:
            if self._is_llm_span(span):       # Check for gen_ai.system attribute
                self._enrich_with_cost(span)    # Calculate and inject cost
        return self.wrapped_exporter.export(spans)  # Forward to real exporter

    def _is_llm_span(self, span):
        return 'gen_ai.system' in (span.attributes or {})

    def _enrich_with_cost(self, span):
        attrs = dict(span.attributes or {})
        model = attrs.get('gen_ai.response.model') or attrs.get('gen_ai.request.model')
        input_tokens = attrs.get('gen_ai.usage.input_tokens', 0)
        output_tokens = attrs.get('gen_ai.usage.output_tokens', 0)

        cost = self.pricing_db.get_cost(model, input_tokens, output_tokens)
        span._attributes.update(cost)  # Inject gen_ai.cost.* attributes
```

When `export()` is called by the `BatchSpanProcessor`, the wrapper:
1. Filters for LLM spans (those with `gen_ai.system` attribute)
2. Extracts model name and token counts from existing span attributes
3. Looks up per-token pricing from the database
4. Calculates `gen_ai.cost.input_usd`, `gen_ai.cost.output_usd`, and `gen_ai.cost.total_usd`
5. Injects the cost attributes into the span
6. Forwards everything to the wrapped exporter

Non-LLM spans pass through untouched — negligible overhead.

> **Important:** These cost estimates are approximations, not invoice-accurate figures. Provider billing includes nuances this approach doesn't capture — OpenAI's cached input tokens (90% cheaper), Anthropic's prompt caching tiers, batch API discounts, and image/tool token pricing. Use this dashboard for relative cost comparison and trend monitoring, not as a replacement for your provider billing dashboard.

### The Pricing Database

![LiteLLM Pricing Database — hundreds of models with per-token pricing](/images/monitoring-llm-usage/litellm-pricing-database.jpg)

Where do we get pricing data for hundreds of models? From [LiteLLM's open-source pricing database](https://github.com/BerriAI/litellm). It's a JSON file on GitHub with per-token pricing for every major provider — OpenAI, Anthropic, Google, Mistral, Cohere, and more.

The `LiteLLMPricingDatabase` class:
- **Syncs from GitHub** on first startup
- **Caches locally** to avoid network calls on subsequent starts
- **Auto-refreshes** when the cache is older than 24 hours
- **Fuzzy matches** model names — `gpt-4o-2024-08-06` resolves to `gpt-4o`, provider prefixes like `openai/gpt-4o` are stripped automatically

### Wiring It Up

![Exporter Wrapping Strategy — strategies for different OTel SDK versions](/images/monitoring-llm-usage/exporter-wrapping.jpg)

The tricky part is finding and wrapping the exporter inside Traceloop's OpenTelemetry configuration. Different versions of the SDK organize their span processors differently, so the `inject_llm_cost_tracking()` function tries multiple strategies:

1. **Direct exporter wrapping** — Find the `BatchSpanProcessor`, extract its exporter, wrap it with `CostEnrichingSpanExporter`, create a new processor
2. **Composite processor traversal** — If Traceloop uses a composite processor with multiple children, iterate and wrap each `BatchSpanProcessor`
3. **Attribute-based discovery** — Check `_active_span_processor`, `_span_processors`, and other internal attributes

The bootstrap is simple — two lines after `Traceloop.init()`:

```python
from traceloop.sdk import Traceloop
from llm_cost_injector import inject_llm_cost_tracking

Traceloop.init(app_name="recipe-generator-service", ...)
inject_llm_cost_tracking()  # Wraps the exporter, loads pricing
```

After this, every LLM span automatically includes cost data. The attributes appear in Elastic APM as:
- `labels.gen_ai_cost_total_usd`
- `labels.gen_ai_cost_input_usd`
- `labels.gen_ai_cost_output_usd`
- `labels.gen_ai_cost_provider`
- `labels.gen_ai_cost_model_resolved`

---

## 9. Getting Started

Ready to build this yourself? Here's the quickstart.

### Prerequisites

- Docker and Docker Compose
- Python 3.11+
- 8GB RAM minimum (Elasticsearch needs headroom)
- OpenAI API key
- Anthropic API key

### Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/maheshbabugorantla/llm-observability-with-elasticapm.git
cd llm-observability-with-elasticapm

# 2. Configure API keys
cp app/.env.example app/.env
# Edit app/.env and add your OPENAI_API_KEY and ANTHROPIC_API_KEY

# 3. Start the full stack
docker compose up --build -d

# 4. Wait for services to be healthy
# Elasticsearch, Kibana, OTel Collector, APM Server, Flask app
# (takes ~60-90 seconds for full startup)
```

### Generate Test Data

```bash
# Flask runs on port 5001 (5000 is reserved by AirPlay on macOS)

# Single recipe generation (OpenAI)
curl -X POST http://localhost:5001/recipe/generate \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai", "dish_name": "Spaghetti Carbonara", "cuisine_type": "Italian", "servings": 4}'

# Compare providers (OpenAI vs Claude, same recipe)
curl -X POST http://localhost:5001/recipe/compare \
  -H "Content-Type: application/json" \
  -d '{"dish_name": "Pad Thai", "cuisine_type": "Thai", "servings": 2}'

# Multi-agent menu design (the full 4-agent workflow)
curl -X POST http://localhost:5001/menu/design \
  -H "Content-Type: application/json" \
  -d '{"cuisine": "Italian", "menu_type": "fine_dining", "courses": 3, "dietary_requirements": ["vegetarian_option"], "budget": "premium", "season": "spring", "occasion": "romantic_dinner"}'
```

### Verify in Kibana

1. Open http://localhost:5601 (login: `elastic` / `changeme`)
2. Navigate to **Observability > APM > Services** — you should see `recipe-generator-service`
3. Click into a transaction to see the **trace waterfall** with nested spans
4. Click on any LLM span and check the **Metadata** tab for `gen_ai.*` attributes
5. Import the dashboard: `curl -X POST "http://localhost:5601/api/saved_objects/_import?overwrite=true" -u elastic:changeme -H "kbn-xsrf: true" --form file=@kibana/llm-observability-dashboards.ndjson`

---

## Conclusion

You now have a complete LLM observability stack built on open standards. Open-standard instrumentation (swap backends anytime), no proprietary agents, no $500/month SaaS bills.

Here's what you get:
- **Cost tracking** — per-call, per-model, with automatic pricing lookup from LiteLLM's open-source pricing database
- **Latency monitoring** — average and P95 response times, broken down by model and endpoint
- **Error correlation** — failed LLM calls with full stack traces, retry counts, and trace context
- **Multi-model comparison** — side-by-side metrics for GPT vs Claude vs any provider
- **Trace correlation** — end-to-end visibility from HTTP request through multi-agent workflows to individual LLM calls

The entire stack runs locally in Docker Compose for development, and the same architecture scales to production with managed Elasticsearch.

Check out the [full source code on GitHub](https://github.com/maheshbabugorantla/llm-observability-with-elasticapm) — star it if you find it useful.

**What's next?** In a future post, I might explore Kibana alerting rules (notify Slack when daily LLM cost exceeds $50), anomaly detection on token usage patterns, and prompt quality scoring using the captured completions data.
