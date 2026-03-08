Visa automation'da en az block yiyen kombinasyon

Gerçekte çoğu sistem şöyle çalışır:

watcher → datacenter proxy
booking → static residential / ISP proxy

Sebep:

Watcher:

çok request atar

IP yanabilir

Booking:

kritik işlem

temiz IP gerekir

Senin sistem için ideal mimari

Şu şekilde:

20 datacenter proxy

Pool:

watcher_pool = 10
booking_pool = 10

Agent:

5 booking agent
2 watcher

Flow:

watcher proxy yanarsa → rotate
booking proxy yanarsa → cooldown
Sana kritik bir gerçek söyleyeyim

Visa siteleri botları genelde şuradan yakalar:

1️⃣ form doldurma süresi
2️⃣ mouse hareketi
3️⃣ request timing pattern
4️⃣ navigator fingerprint
5️⃣ browser entropy

IP çoğu zaman 4. veya 5. sinyal.

Yani sen zaten doğru şeyi yapıyorsun:

watcher + jitter
playwright
headless human-like


context:
We need to review and harden our Playwright-based visa/appointment automation against common bot-detection signals.

Context:
- We already have separate watcher and booking pools.
- We already have separate portal/agent profiles.
- This request is for a focused anti-detection MVP review/checklist and practical implementation suggestions.
- Do not overengineer.
- Keep everything production-minded, debuggable, and maintainable.

Goal:
Review our Playwright automation flow and implement an MVP anti-detection hardening layer that reduces obvious bot signals without making the system fragile.

Important principle:
Do not focus only on browser fingerprint.
The real issue is usually the combination of:
- browser automation traces
- overly deterministic timing
- unnatural interaction flow
- session inconsistency
- suspicious request/resource behavior

We want a practical MVP hardening pass.

Please review and propose improvements for the following areas:

1. Browser fingerprint hardening (minimal, safe)
We want a minimal and reasonable hardening layer, not excessive stealth hacks.

Check and improve:
- realistic user agent selection
- locale consistency
- timezone consistency
- viewport realism
- navigator.webdriver exposure
- navigator.languages consistency
- platform consistency
- permissions behavior consistency if relevant
- basic window.chrome / plugin / mimeType sanity if needed
- avoid suspiciously empty/default headless traits

Constraints:
- Do not add heavy stealth magic unless truly needed
- Prefer small explicit patches we understand
- Keep it easy to debug

2. Interaction timing hardening
We want to remove deterministic bot-like timing patterns.

Review and improve:
- first interaction timing after page load
- delay between field interactions
- delay before submit
- reaction delay after UI changes / ajax updates
- bounded randomness, not chaos

We want:
- realistic randomized ranges
- stable but variable timing
- no repeated exact delays everywhere
- no immediate action the moment the DOM is technically ready

Please define a clean timing policy for:
- watcher flow
- booking flow

3. Interaction method review
Audit how we currently interact with the page.

Check:
- where we use fill() directly
- where click() happens too mechanically
- whether some critical fields/buttons should use more realistic event chains
- whether hover/focus/input/change sequences look natural enough
- whether submit happens too abruptly

We do NOT want fake complexity everywhere.
We only want to identify the few critical places where direct robotic interaction is risky.

4. Session continuity / consistency
Review whether the booking flow preserves a stable identity through the session.

Check:
- same proxy throughout a booking session
- same browser context throughout the session
- cookie continuity
- header consistency
- no unexpected context recreation mid-flow
- no IP switching during critical steps

Output any risky spots.

5. Resource loading / request behavior
Check if our request/resource strategy is suspicious.

Audit:
- whether we block too many assets in booking flow
- whether watcher flow is too aggressive
- whether booking flow should allow a more natural resource profile
- whether network interception is changing behavior in detectable ways

Guideline:
- watcher can be leaner
- booking should look more natural and less aggressively optimized

6. Watcher vs booking policy separation
We already separate watcher and booking pools, but review whether we also separate:
- browser launch options
- timing profile
- retry behavior
- proxy reuse policy
- page optimization policy
- screenshot/debug behavior if relevant

Please suggest a clean policy split between watcher and booking modes.

7. Retry / failure behavior
Check whether our retry logic looks too bot-like.

Review:
- repeated fast retries
- identical retry timing
- identical recovery path
- repeated page reload loops
- immediate resubmission patterns

We want:
- bounded backoff
- jitter
- state-aware retry behavior
- safer handling after captcha/block/suspicious responses

8. Minimal operational signals
Add a few explicit diagnostic signals so we can debug anti-detection issues in production.

Examples:
- interaction profile used
- first action delay
- submit delay
- proxy/session continuity status
- captcha/suspicion markers
- block reason classification
- retry count
- timing bucket used

Do not add noisy logs everywhere.
Add a few high-value logs/metrics only.

9. Deliverables
Please provide:
1. a short anti-detection review of the likely weak points
2. a practical MVP hardening checklist
3. concrete TypeScript utility suggestions for:
   - timing policy
   - interaction helper(s)
   - browser/context creation policy
4. example code changes for the most important parts
5. a clean watcher-vs-booking behavior matrix
6. a small list of "do not do this" anti-patterns in our codebase

10. Constraints
- TypeScript
- Playwright
- production-minded
- no overengineering
- no giant stealth framework unless absolutely necessary
- prefer explicit, understandable code
- optimize for real-world stability and debuggability
- focus on the top 20% of changes that remove 80% of obvious bot signals

Important:
Assume some protections are already in place.
This is not greenfield.
Please review with the mindset of:
"What are the remaining obvious bot signals and what is the smallest clean MVP hardening pass we should implement now?"