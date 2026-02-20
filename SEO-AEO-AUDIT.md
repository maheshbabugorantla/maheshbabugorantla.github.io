# SEO & AEO Audit Report

**Post:** [Monitoring LLM Usage with Elastic APM & OpenLLMetry](https://maheshbabugorantla.github.io/posts/monitoring-llm-usage-elastic-apm-openllmetry/)
**Audit Date:** 2026-02-20

---

## Overall Scores

| Category | Score |
|---|---|
| **SEO** | **6.5 / 10** |
| **AEO** | **4 / 10** |

---

## Detailed SEO Scorecard

| Category | Score | Key Finding |
|---|---|---|
| Title & URL | 8.5/10 | Strong keyword-rich title (52 chars) and clean slug |
| Meta Description | 7/10 | Good length (138 chars) but lacks call-to-action |
| Heading Structure | 8/10 | Clean H2→H3 hierarchy, numbered for scannability |
| Image SEO | 9/10 | All 12 images have descriptive alt text with keywords |
| Content Depth | 9/10 | ~4,500+ words, code examples, diagrams, comparisons |
| Structured Data (Schema) | 4/10 | No author, no FAQ schema, no HowTo schema |
| Social Sharing (OG/Twitter) | 5/10 | No cover image, no Twitter handle configured |
| Internal Linking | 2/10 | Zero internal links to other posts or pages |
| External Linking | 8/10 | Links to authoritative sources (OTel, Elastic, GitHub) |
| Technical Config | 6/10 | Missing `env`, `author`, `description` in hugo.toml |

---

## SEO Analysis

### What's Working Well

#### Title (8/10)
- **Current:** `"Monitoring LLM Usage with Elastic APM & OpenLLMetry"`
- 52 characters — safely under the 60-character SERP display limit
- Contains all primary keywords: `LLM`, `Elastic APM`, `OpenLLMetry`, `Monitoring`
- Clear and descriptive for both users and search engines

#### URL Slug (9/10)
- **Current:** `/posts/monitoring-llm-usage-elastic-apm-openllmetry/`
- Keyword-rich, lowercase, hyphenated — textbook good
- No unnecessary words or IDs

#### Meta Description (7/10)
- **Current:** `"From zero-code instrumentation to full observability — a hands-on guide to monitoring LLM cost, latency, and errors with Elastic APM and OpenLLMetry."`
- 138 characters — under the 160-character limit
- Contains keywords: `LLM cost`, `latency`, `errors`, `Elastic APM`, `OpenLLMetry`

**Suggestion:** Add a differentiator or call-to-action:
```
"A hands-on guide to monitoring LLM cost, latency, and errors with Elastic APM and OpenLLMetry — with code examples, architecture diagrams, and a ready-to-run companion repo."
```
(176 chars — slightly long but Google often displays more for how-to content)

#### Heading Hierarchy (8/10)
- Clean H2→H3 nesting with no levels skipped
- 9 H2 sections and 8 H3 subsections
- Numbered headings (`## 1.`, `## 2.`, etc.) aid readability and scannability
- Good descriptive subheadings like "The Hard Way: Manual OpenTelemetry" vs "The Easy Way: OpenLLMetry"

#### Image Alt Text (9/10)
All 12 images have descriptive alt text containing relevant keywords:
- `"OpenTelemetry Basics — Traces, Spans, Exporters, Collectors"`
- `"System Architecture — Flask to OpenLLMetry to OTel Collector to APM to ES to Kibana"`
- `"Trace waterfall in Kibana APM — nested spans showing parallel agent execution and cross-model calls"`
- etc.

#### Content Depth (9/10)
- ~530 lines, ~4,500+ words — comprehensive pillar content
- Code examples with line-by-line explanations
- Architecture diagrams, comparison tables, production warnings
- Before/after comparisons for manual vs automated instrumentation

#### External Linking (8/10)
- Links to authoritative sources: OpenTelemetry docs, Traceloop GitHub, Elastic APM docs, LiteLLM
- Links to companion GitHub repo with full source code
- Links to OTel semantic conventions spec

---

### Critical SEO Issues

#### Issue 1: `env = "production"` Not Set in `hugo.toml` (Impact: HIGH)

**Location:** `hugo.toml`
**Theme template:** `themes/PaperMod/layouts/partials/head.html`, lines 200-205

```go
{{- if hugo.IsProduction | or (eq site.Params.env "production") }}
{{- partial "templates/opengraph.html" . }}
{{- partial "templates/twitter_cards.html" . }}
{{- partial "templates/schema_json.html" . }}
{{- end -}}
```

**Impact:** Hugo's `hugo` command defaults to production environment, so your GitHub Actions build (`hugo --minify`) DOES render these tags on the deployed site. However, `hugo server` for local development does NOT, making it impossible to test/verify Open Graph tags, Twitter Cards, and Schema JSON-LD locally.

**Fix:** Add to `hugo.toml` under `[params]`:
```toml
env = "production"
```

---

#### Issue 2: No `author` Configured Anywhere (Impact: HIGH)

**Locations checked:**
- Post front matter: No `author` field
- `hugo.toml` `[params]`: No `author` field

**Impact:** The PaperMod Schema JSON-LD template (`schema_json.html`, line 95) uses:
```go
{{- with (.Params.author | default site.Params.author) }}
```
Both are empty, so the `BlogPosting` structured data is generated **without an author field**. This hurts:
- Google's E-E-A-T (Experience, Expertise, Authoritativeness, Trust) signals
- AI answer engine citation trust
- Rich result eligibility

**Fix — Option A (site-wide default):** Add to `hugo.toml` under `[params]`:
```toml
author = "Mahesh Babu Gorantla"
```

**Fix — Option B (per-post):** Add to the post front matter:
```yaml
author: "Mahesh Babu Gorantla"
```

**Recommendation:** Do both. Site-wide default covers all posts; per-post override allows guest posts.

---

#### Issue 3: No `cover.image` in Post Front Matter (Impact: MEDIUM-HIGH)

**Location:** Post front matter (missing)

**Impact:**
- Without `cover.image`, PaperMod falls back to `get-page-images` which tries to extract images from content body — unreliable and non-deterministic
- Twitter Cards will fall back to `summary` (small thumbnail) instead of `summary_large_image`
- Social sharing on LinkedIn, Twitter/X, Slack — no guaranteed preview image
- The post has 12 great images but none is designated as the hero/social image

**Fix:** Add to front matter:
```yaml
cover:
  image: "/images/monitoring-llm-usage/architecture.png"
  alt: "LLM Monitoring Architecture — Flask to OpenLLMetry to OTel Collector to Elastic APM to Kibana"
  caption: "Full LLM observability stack architecture"
  relative: false
```

Choose whichever image best represents the post (architecture diagram is recommended as it shows the full stack).

---

#### Issue 4: No Site-Level `description` in `hugo.toml` (Impact: MEDIUM)

**Location:** `hugo.toml` `[params]`

**Impact:**
- `site.Params.description` is empty
- Affects homepage meta description tag
- Acts as fallback for any page/section that doesn't have its own description
- The homepage Schema JSON-LD `Organization` entity has an empty `description` field

**Fix:** Add to `hugo.toml` under `[params]`:
```toml
description = "Technical blog by Mahesh Babu Gorantla — Python, Django, Kubernetes, observability, and backend engineering."
```

---

#### Issue 5: Zero Internal Links (Impact: MEDIUM)

**Location:** Post body content

**Impact:**
- No cross-links to other posts on the blog
- Internal linking distributes page authority (PageRank flow)
- Helps crawlers discover and index other content
- Reduces bounce rate by guiding readers to related content
- AI answer engines consider interlinked content as more authoritative

**Fix:** Add links where natural:
- Link to your About page when mentioning "our team" or personal experience
- If you have other posts about Python, Kubernetes, or observability, link to them from relevant sections
- Add a "Related Posts" mention at the end, or use Hugo's built-in related content feature

---

#### Issue 6: Tags Are Too Generic (Impact: LOW-MEDIUM)

**Current tags:**
```yaml
tags: ["llm", "observability", "opentelemetry", "elasticsearch", "apm", "python", "openllmetry"]
```

**Issue:** These are single generic terms. They create tag pages but don't target long-tail search phrases.

**Suggested additions/replacements:**
```yaml
tags:
  - llm-observability
  - opentelemetry
  - openllmetry
  - elastic-apm
  - llm-cost-tracking
  - python
  - elasticsearch
  - llm-monitoring
```

---

#### Issue 7: No `keywords` in Front Matter (Impact: LOW)

**Current behavior:** PaperMod falls back to `tags` for `<meta name="keywords">`, which works. But separate `keywords` allow you to target more specific search phrases without creating a tag page for each.

**Fix:** Add to front matter:
```yaml
keywords:
  - monitor llm usage elastic apm
  - openllmetry tutorial
  - opentelemetry llm instrumentation
  - llm cost tracking production
  - elastic apm llm observability
  - llm token usage monitoring
  - opentelemetry gen_ai semantic conventions
```

---

#### Issue 8: No `lastmod` in Front Matter (Impact: LOW)

**Current behavior:** The Schema JSON-LD outputs `dateModified` from Hugo's `.Lastmod`. Without explicit `lastmod`, Hugo defaults to `date`, so `datePublished` and `dateModified` are identical — missing the signal that content is maintained/updated.

**Fix:** Add to front matter whenever you update the post:
```yaml
lastmod: 2026-02-20T12:00:00-06:00
```

---

#### Issue 9: Missing Site-Level SEO Configuration (Impact: LOW)

**Location:** `hugo.toml`

Several PaperMod SEO features are not enabled:

```toml
# Add these to hugo.toml

[params]
  env = "production"
  author = "Mahesh Babu Gorantla"
  description = "Technical blog by Mahesh Babu Gorantla — Python, Django, Kubernetes, observability, and backend engineering."
  keywords = ["python", "django", "kubernetes", "observability", "backend engineering", "llm"]

[params.schema]
  publisherType = "Person"

# If you have a Twitter/X handle:
# [params.social]
#   twitter = "yourtwitterhandle"

# If you have Google Search Console set up:
# [params.analytics.google]
#   SiteVerificationTag = "your-verification-tag"
```

---

## AEO (Answer Engine Optimization) Analysis

AEO focuses on how well your content can be extracted and cited by AI-powered answer engines: Google AI Overviews (SGE), ChatGPT with search, Perplexity, Bing Copilot, and similar tools. These engines extract direct answers, definitions, procedures, and Q&A pairs from web content.

### AEO Scorecard

| Category | Score | Key Finding |
|---|---|---|
| Structured Comparisons | 7/10 | OTel mapping table and before/after code are highly extractable |
| Step-by-Step Instructions | 6/10 | Getting Started section is clear but lacks HowTo schema |
| Authoritative Depth | 7/10 | Production caveats and tradeoff discussions signal expertise |
| FAQ / Q&A Content | 1/10 | No FAQ section, no question-answer pairs |
| FAQ Schema Markup | 0/10 | No FAQPage JSON-LD structured data |
| TL;DR / Summary Block | 0/10 | No concise extractable summary at the top |
| Question-Phrased Headings | 2/10 | All headings are declarative, not query-matching |
| Definition Blocks | 3/10 | Key terms explained in prose, not standalone definitions |
| HowTo Schema | 0/10 | Section 9 is a tutorial but lacks HowTo JSON-LD |

### What's Working for AEO

#### Structured Comparisons (7/10)
- The OTel-to-OpenLLMetry mapping table (Section 2) provides clean, structured data that AI engines can extract directly
- The Before vs After code comparison (Section 3) is excellent for "how to" and "comparison" queries
- The monitoring capabilities overview (Section 6) is a scannable table of features

#### Step-by-Step Instructions (6/10)
- Section 9 ("Getting Started") provides a clear procedural sequence:
  1. Prerequisites → 2. Quick Start → 3. Generate Test Data → 4. Verify in Kibana
- AI engines can extract this as a procedural answer

#### Authoritative Technical Depth (7/10)
- Production safety warnings, tradeoff discussions, and caveats signal genuine expertise
- Important for E-E-A-T and AI citation trust
- Linking to specs and official docs supports claims

### Critical AEO Gaps

#### Gap 1: No FAQ Section (Impact: CRITICAL)

Your post naturally answers many questions that users ask AI engines:

- "How do I monitor LLM costs in production?"
- "What is OpenLLMetry?"
- "How does OpenTelemetry work with LLMs?"
- "How do I track token usage across multiple LLM providers?"
- "What gen_ai attributes does OpenLLMetry capture?"
- "How do I set up Elastic APM for LLM monitoring?"

But these answers are **buried in prose**. AI engines strongly prefer explicit Q&A pairs they can extract directly.

**Fix:** Add a `## Frequently Asked Questions` section before the Conclusion. Suggested questions:

```markdown
## Frequently Asked Questions

### What is OpenLLMetry and how is it different from OpenTelemetry?

OpenLLMetry is Traceloop's open-source instrumentation layer built on top of OpenTelemetry. While OpenTelemetry provides generic observability (traces, metrics, logs), OpenLLMetry adds automatic capture of LLM-specific attributes like `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, and `gen_ai.system`. It uses `@workflow` and `@task` decorators that map to OTel traces and spans, giving you LLM observability without manual attribute setting.

### How do I track LLM costs in production with Elastic APM?

Use the CostEnrichingSpanExporter pattern described in this guide: wrap your OTLP exporter with a custom exporter that intercepts LLM spans, looks up the model's per-token pricing from LiteLLM's pricing database, calculates the cost from token counts, and injects a `gen_ai.usage.cost` attribute before the span is exported. This gives you per-request cost data visible in Kibana dashboards.

### What gen_ai attributes does OpenLLMetry automatically capture?

OpenLLMetry automatically captures: `gen_ai.system` (provider name), `gen_ai.request.model` (requested model), `gen_ai.response.model` (actual model used), `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.request.temperature`, `gen_ai.request.max_tokens`, and more. These follow the OpenTelemetry Semantic Conventions for Generative AI.

### Can I use OpenLLMetry with backends other than Elastic?

Yes. OpenLLMetry produces standard OpenTelemetry data exported via OTLP. You can send it to any OTLP-compatible backend: Jaeger, Datadog, Grafana Tempo, Honeycomb, or any other OpenTelemetry Collector destination. Only the exporter configuration changes — the instrumentation code stays the same.

### Does OpenLLMetry log my prompts and completions?

By default, OpenLLMetry can log prompt and completion content into span attributes. For production, disable this with `export TRACELOOP_TRACE_CONTENT=false` to avoid leaking sensitive data. With content tracing disabled, it still captures all metadata (model, tokens, latency, errors) without recording prompts or responses.
```

---

#### Gap 2: No FAQ Schema (`FAQPage`) Markup (Impact: CRITICAL)

Even with an FAQ section in content, without `FAQPage` JSON-LD structured data, Google's rich results and AI Overviews won't treat it as structured Q&A.

PaperMod doesn't include FAQ schema by default. You need a custom partial.

**Fix — Create a new layout partial:** `layouts/partials/faq-schema.html`

```html
{{ if .Params.faq }}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {{ range $i, $faq := .Params.faq }}
    {{ if $i }},{{ end }}
    {
      "@type": "Question",
      "name": {{ $faq.question | jsonify }},
      "acceptedAnswer": {
        "@type": "Answer",
        "text": {{ $faq.answer | jsonify }}
      }
    }
    {{ end }}
  ]
}
</script>
{{ end }}
```

**Then update `layouts/partials/extend_head.html`:**
```html
{{- if .Params.ShowToc }}
<script src="{{ "js/toc-scroll-spy.js" | absURL }}"></script>
{{- end }}

{{- partial "faq-schema.html" . -}}
```

**Then add FAQ data to the post front matter:**
```yaml
faq:
  - question: "What is OpenLLMetry and how is it different from OpenTelemetry?"
    answer: "OpenLLMetry is Traceloop's open-source instrumentation layer built on top of OpenTelemetry. While OpenTelemetry provides generic observability, OpenLLMetry adds automatic capture of LLM-specific attributes like gen_ai.request.model, token counts, and gen_ai.system using simple decorators."
  - question: "How do I track LLM costs in production with Elastic APM?"
    answer: "Use a CostEnrichingSpanExporter that wraps your OTLP exporter, intercepts LLM spans, looks up per-token pricing from LiteLLM's database, and injects a gen_ai.usage.cost attribute before export."
  - question: "What gen_ai attributes does OpenLLMetry automatically capture?"
    answer: "OpenLLMetry captures gen_ai.system, gen_ai.request.model, gen_ai.response.model, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens, gen_ai.request.temperature, gen_ai.request.max_tokens, and more following OpenTelemetry Semantic Conventions."
  - question: "Can I use OpenLLMetry with backends other than Elastic?"
    answer: "Yes. OpenLLMetry produces standard OpenTelemetry data via OTLP. You can send it to Jaeger, Datadog, Grafana Tempo, Honeycomb, or any OTLP-compatible backend by changing only the exporter configuration."
  - question: "Does OpenLLMetry log my prompts and completions?"
    answer: "By default it can, but for production set TRACELOOP_TRACE_CONTENT=false to disable content tracing. It will still capture all metadata (model, tokens, latency, errors) without recording prompts or responses."
```

---

#### Gap 3: No TL;DR / Summary Block (Impact: HIGH)

AI answer engines look for concise, self-contained answer paragraphs near the top of a page. Your post opens with a narrative hook ("You shipped an LLM-powered feature...") which is engaging for humans but doesn't give AI a quick extractable answer.

**Fix:** Add a "Key Takeaways" block immediately after the front matter and before the narrative intro:

```markdown
> **Key Takeaways:**
> - **OpenLLMetry** auto-instruments LLM calls with 2 lines of setup, capturing model, token counts, latency, and errors as OpenTelemetry spans.
> - Combined with **Elastic APM** and an OTel Collector, you get full LLM observability in Kibana — cost tracking, latency heatmaps, error correlation, and multi-model comparison.
> - The **CostEnrichingSpanExporter** pattern injects per-request cost data using LiteLLM's pricing database, giving you dollar-level visibility.
> - The entire stack is **vendor-neutral**: swap any component without changing instrumentation code.
```

---

#### Gap 4: No Question-Phrased Headings (Impact: HIGH)

AI engines match user queries to page headings. Current headings are declarative:
- "Enter OpenLLMetry"
- "System Architecture"
- "What You Can Monitor"
- "Going Further: Automatic Cost Tracking"

Users ask AI engines questions like:
- "How does OpenLLMetry work?"
- "What does the LLM monitoring architecture look like?"
- "What metrics can I monitor for LLMs?"
- "How do I add automatic cost tracking to LLM calls?"

**Fix — Suggested heading rewrites:**

| Current Heading | Suggested Rewrite |
|---|---|
| `## 2. Enter OpenLLMetry` | `## 2. What Is OpenLLMetry and How Does It Extend OpenTelemetry?` |
| `## 4. System Architecture` | `## 4. What Does the LLM Monitoring Architecture Look Like?` |
| `## 6. What You Can Monitor` | `## 6. What Metrics Can You Monitor for LLMs in Production?` |
| `## 8. Going Further: Automatic Cost Tracking` | `## 8. How Do You Add Automatic Cost Tracking to LLM Calls?` |
| `## 9. Getting Started` | `## 9. How Do You Set Up LLM Monitoring with Elastic APM?` |

**Note:** You don't need to rephrase ALL headings — a mix of declarative and question-phrased headings is natural. Target the ones that match high-intent search queries.

---

#### Gap 5: No Standalone Definition Blocks (Impact: MEDIUM)

Key terms are explained in context but never given a clear, standalone definition that AI can extract as a featured snippet.

**Fix:** Add a brief definition callout for key terms when they first appear:

```markdown
> **OpenLLMetry** is an open-source, vendor-neutral instrumentation library by Traceloop
> that automatically captures LLM-specific telemetry (model, tokens, cost, latency)
> as OpenTelemetry spans, requiring only decorator-based setup with no manual attribute code.
```

Terms that would benefit from definition blocks:
- OpenLLMetry (Section 2)
- `gen_ai.*` attributes (Section 2)
- CostEnrichingSpanExporter (Section 8)
- `@workflow` and `@task` decorators (Section 2)

---

#### Gap 6: No `HowTo` Schema Markup (Impact: MEDIUM)

Section 9 ("Getting Started") is a step-by-step tutorial. `HowTo` JSON-LD schema would make it eligible for Google's how-to rich results and improve extraction by AI engines.

**Fix — Create `layouts/partials/howto-schema.html`:**

```html
{{ if .Params.howto }}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": {{ .Params.howto.name | jsonify }},
  "description": {{ .Params.howto.description | jsonify }},
  "totalTime": {{ .Params.howto.totalTime | default "PT15M" | jsonify }},
  "step": [
    {{ range $i, $step := .Params.howto.steps }}
    {{ if $i }},{{ end }}
    {
      "@type": "HowToStep",
      "name": {{ $step.name | jsonify }},
      "text": {{ $step.text | jsonify }},
      "position": {{ add $i 1 }}
    }
    {{ end }}
  ]
}
</script>
{{ end }}
```

**Add to `extend_head.html`:**
```html
{{- partial "howto-schema.html" . -}}
```

**Add HowTo data to post front matter:**
```yaml
howto:
  name: "Set Up LLM Monitoring with Elastic APM and OpenLLMetry"
  description: "How to build a full LLM observability stack with OpenLLMetry, OpenTelemetry Collector, and Elastic APM for cost tracking, latency metrics, and error correlation."
  totalTime: "PT15M"
  steps:
    - name: "Install prerequisites"
      text: "Install Docker, Docker Compose, and Python 3.11+."
    - name: "Clone the companion repository"
      text: "Clone the repo and copy the example environment file: git clone the repo, then cp .env.example .env and add your OpenAI API key."
    - name: "Start the infrastructure"
      text: "Run docker compose up -d to start the OTel Collector, Elasticsearch, and Kibana."
    - name: "Generate test data"
      text: "Run python main.py to trigger multi-agent LLM workflows that generate trace data."
    - name: "Verify in Kibana"
      text: "Open Kibana at localhost:5601, navigate to APM > Services, and find recipe-generator-service to see traces, spans, and LLM metrics."
```

---

## Complete Front Matter Recommendation

Here is the recommended updated front matter for the post:

```yaml
---
title: "Monitoring LLM Usage with Elastic APM & OpenLLMetry"
date: 2026-02-15T12:00:00-06:00
lastmod: 2026-02-20T12:00:00-06:00
draft: false
author: "Mahesh Babu Gorantla"
tags:
  - llm-observability
  - opentelemetry
  - openllmetry
  - elastic-apm
  - llm-cost-tracking
  - python
  - elasticsearch
  - llm-monitoring
keywords:
  - monitor llm usage elastic apm
  - openllmetry tutorial
  - opentelemetry llm instrumentation
  - llm cost tracking production
  - elastic apm llm observability
  - llm token usage monitoring
  - opentelemetry gen_ai semantic conventions
description: "A hands-on guide to monitoring LLM cost, latency, and errors with Elastic APM and OpenLLMetry — with architecture diagrams, code examples, and a ready-to-run companion repo."
cover:
  image: "/images/monitoring-llm-usage/architecture.png"
  alt: "LLM Monitoring Architecture — Flask to OpenLLMetry to OTel Collector to Elastic APM to Kibana"
  caption: "Full LLM observability stack architecture"
  relative: false
ShowToc: true
TocOpen: true
faq:
  - question: "What is OpenLLMetry and how is it different from OpenTelemetry?"
    answer: "OpenLLMetry is Traceloop's open-source instrumentation layer built on top of OpenTelemetry. While OpenTelemetry provides generic observability, OpenLLMetry adds automatic capture of LLM-specific attributes like gen_ai.request.model, token counts, and gen_ai.system using simple decorators."
  - question: "How do I track LLM costs in production with Elastic APM?"
    answer: "Use a CostEnrichingSpanExporter that wraps your OTLP exporter, intercepts LLM spans, looks up per-token pricing from LiteLLM's database, and injects a gen_ai.usage.cost attribute before export."
  - question: "What gen_ai attributes does OpenLLMetry automatically capture?"
    answer: "OpenLLMetry captures gen_ai.system, gen_ai.request.model, gen_ai.response.model, gen_ai.usage.input_tokens, gen_ai.usage.output_tokens, gen_ai.request.temperature, gen_ai.request.max_tokens, and more following OpenTelemetry Semantic Conventions."
  - question: "Can I use OpenLLMetry with backends other than Elastic?"
    answer: "Yes. OpenLLMetry produces standard OpenTelemetry data via OTLP. You can send it to Jaeger, Datadog, Grafana Tempo, Honeycomb, or any OTLP-compatible backend by changing only the exporter configuration."
  - question: "Does OpenLLMetry log my prompts and completions?"
    answer: "By default it can, but for production set TRACELOOP_TRACE_CONTENT=false to disable content tracing. It will still capture all metadata (model, tokens, latency, errors) without recording prompts or responses."
howto:
  name: "Set Up LLM Monitoring with Elastic APM and OpenLLMetry"
  description: "Build a full LLM observability stack with OpenLLMetry, OpenTelemetry Collector, and Elastic APM."
  totalTime: "PT15M"
  steps:
    - name: "Install prerequisites"
      text: "Install Docker, Docker Compose, and Python 3.11+."
    - name: "Clone the companion repository"
      text: "Clone the repo and copy the example environment file with your OpenAI API key."
    - name: "Start the infrastructure"
      text: "Run docker compose up -d to start OTel Collector, Elasticsearch, and Kibana."
    - name: "Generate test data"
      text: "Run python main.py to trigger multi-agent LLM workflows."
    - name: "Verify in Kibana"
      text: "Open Kibana at localhost:5601 and navigate to APM > Services to see traces and LLM metrics."
---
```

---

## Complete `hugo.toml` Recommendation

```toml
baseURL = 'https://maheshbabugorantla.github.io/'
languageCode = 'en-us'
title = 'Mahesh Babu Gorantla - Tech Blog'
theme = 'PaperMod'

[params]
  env = "production"
  author = "Mahesh Babu Gorantla"
  description = "Technical blog by Mahesh Babu Gorantla — Python, Django, Kubernetes, observability, and backend engineering."
  keywords = ["python", "django", "kubernetes", "observability", "backend engineering", "llm"]
  ShowToc = true
  TocOpen = true
  ShowCodeCopyButtons = true
  ShowReadingTime = true
  ShowShareButtons = true
  ShowPostNavLinks = true
  ShowBreadCrumbs = true

[params.schema]
  publisherType = "Person"

# Uncomment and fill in if you have these:
# [params.social]
#   twitter = "yourtwitterhandle"
#
# [params.analytics.google]
#   SiteVerificationTag = "your-google-search-console-verification-tag"

[params.homeInfoParams]
  Title = "Hi, I'm Mahesh Babu Gorantla"
  Content = "Full-stack engineer writing about Python, Django, Kubernetes, and backend development"

[[params.socialIcons]]
  name = "github"
  url = "https://github.com/maheshbabugorantla"

[[params.socialIcons]]
  name = "linkedin"
  url = "https://linkedin.com/in/maheshbabugorantla"

[[menu.main]]
  name = "Posts"
  url = "/posts/"
  weight = 1

[[menu.main]]
  name = "Tags"
  url = "/tags/"
  weight = 2

[[menu.main]]
  name = "About"
  url = "/about/"
  weight = 3

[markup]
  [markup.highlight]
    style = 'monokai'
    lineNos = true
    lineNumbersInTable = true
    noClasses = false
```

---

## New Files to Create

### 1. `layouts/partials/faq-schema.html`
```html
{{ if .Params.faq }}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {{ range $i, $faq := .Params.faq }}
    {{ if $i }},{{ end }}
    {
      "@type": "Question",
      "name": {{ $faq.question | jsonify }},
      "acceptedAnswer": {
        "@type": "Answer",
        "text": {{ $faq.answer | jsonify }}
      }
    }
    {{ end }}
  ]
}
</script>
{{ end }}
```

### 2. `layouts/partials/howto-schema.html`
```html
{{ if .Params.howto }}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "HowTo",
  "name": {{ .Params.howto.name | jsonify }},
  "description": {{ .Params.howto.description | jsonify }},
  "totalTime": {{ .Params.howto.totalTime | default "PT15M" | jsonify }},
  "step": [
    {{ range $i, $step := .Params.howto.steps }}
    {{ if $i }},{{ end }}
    {
      "@type": "HowToStep",
      "name": {{ $step.name | jsonify }},
      "text": {{ $step.text | jsonify }},
      "position": {{ add $i 1 }}
    }
    {{ end }}
  ]
}
</script>
{{ end }}
```

### 3. Updated `layouts/partials/extend_head.html`
```html
{{- if .Params.ShowToc }}
<script src="{{ "js/toc-scroll-spy.js" | absURL }}"></script>
{{- end }}

{{- partial "faq-schema.html" . -}}
{{- partial "howto-schema.html" . -}}
```

---

## Content Changes to the Post Body

### Add Key Takeaways block (after front matter, before the narrative intro)

```markdown
> **Key Takeaways:**
> - **OpenLLMetry** auto-instruments LLM calls with 2 lines of setup, capturing model, token counts, latency, and errors as OpenTelemetry spans.
> - Combined with **Elastic APM** and an OTel Collector, you get full LLM observability in Kibana — cost tracking, latency heatmaps, error correlation, and multi-model comparison.
> - The **CostEnrichingSpanExporter** pattern injects per-request cost data using LiteLLM's pricing database, giving you dollar-level visibility.
> - The entire stack is **vendor-neutral**: swap any component without changing instrumentation code.
```

### Rephrase select headings to match search queries

| Current | Suggested |
|---|---|
| `## 2. Enter OpenLLMetry` | `## 2. What Is OpenLLMetry and How Does It Extend OpenTelemetry?` |
| `## 4. System Architecture` | `## 4. What Does the Full Monitoring Architecture Look Like?` |
| `## 6. What You Can Monitor` | `## 6. What Metrics Can You Monitor for LLMs in Production?` |
| `## 8. Going Further: Automatic Cost Tracking` | `## 8. How Do You Add Automatic Cost Tracking to LLM Calls?` |
| `## 9. Getting Started` | `## 9. How Do You Set Up LLM Monitoring with Elastic APM?` |

### Add FAQ section before the Conclusion

See the full FAQ text in the "Gap 1" section above.

---

## Priority Implementation Order

| Priority | Change | SEO Impact | AEO Impact | Effort |
|---|---|---|---|---|
| 1 | Add `author` to hugo.toml + front matter | HIGH | HIGH | 2 min |
| 2 | Add `cover.image` to front matter | HIGH | LOW | 2 min |
| 3 | Add `env = "production"` + site `description` to hugo.toml | MEDIUM | LOW | 2 min |
| 4 | Add FAQ section to post content | LOW | CRITICAL | 15 min |
| 5 | Create FAQ schema partial + front matter data | MEDIUM | CRITICAL | 10 min |
| 6 | Add Key Takeaways / TL;DR block | LOW | HIGH | 5 min |
| 7 | Rephrase select headings as questions | LOW | HIGH | 5 min |
| 8 | Add `keywords` + `lastmod` to front matter | LOW | LOW | 2 min |
| 9 | Create HowTo schema partial + front matter data | MEDIUM | MEDIUM | 10 min |
| 10 | Add internal links | MEDIUM | LOW | 5 min |

---

*Generated by Claude Code — 2026-02-20*
