# VISA Plugin System Architecture

## Overview

The VISA plugin system enables extensibility through **runtime registration**, **modular packaging**, and **optional lazy-loading**. The core worker remains stable while behavior is extended through pluggable modules that can be added or removed without modifying the core system.

## 1. Plugin Definition

A plugin in this system is an **independent module that implements a specific contract (interface)**.

---

## 2. Plugin Types

### A) Portal Plugins

**Purpose:** Each portal (e.g., as-visa, idata) acts as a "portal driver package".

**How it works:**
- Plugins are registered at runtime via `registerPortal(driver)`
- Core logic reads the portal configuration → retrieves the driver from the registry → calls `driver.run()`

**Benefits:**
- Adding a new portal requires no changes to core code
- Simply add a new folder/package and register it

**Example Structure:**
```
apps/worker/src/portals/
  ├── as-visa/
  ├── idata/
  └── registry.ts
```

---

### B) CAPTCHA / Turnstile Solver Plugin

**Purpose:** Unified interface for CAPTCHA solving: `solve(type, context)`

**Implementations:**
- Manual/HITL (Human-in-the-Loop)
- Vendor A solver
- Vendor B solver

**Configuration:**
```typescript
{
  captchaMode: "hitl" | "solver",
  solverProvider: "vendor-a" | "vendor-b"
}
```

**Implementation:** `core/anti-bot/solver-registry.ts`

---

### C) Proxy Provider Plugin

**Purpose:** Manages proxy pool provisioning and rotation

**Implementations:**
- Static proxy list
- Provider API integration (Oxylabs, SmartProxy, etc.)
- Sticky session management

**Configuration:**
```typescript
{
  proxy: {
    strategy: "rotation" | "sticky",
    providers: ["provider-a", "provider-b"]
  }
}
```

**Implementation:** `proxy-manager` with provider registry + `getProxy(sessionKey)`

---

### D) Evidence / Storage Plugin

**Purpose:** Handles storage of screenshots, HTML snapshots, and downloads

**Implementations:**
- Local filesystem
- S3-compatible storage (MinIO)
- Cloud bucket (AWS S3, Google Cloud Storage)

**Configuration:** Per-tenant or global config

**Implementation:** Storage adapter interface with runtime selection

---

### E) Notification Plugin

**Purpose:** Delivers HITL notifications through various channels

**Implementations:**
- Email
- Webhook
- Slack/Telegram

**Configuration:** Per-tenant notification settings

---

### F) Observability Plugin

**Purpose:** Configurable logging, metrics, and tracing backends

**Implementations:**
- Pino stdout logging
- OpenTelemetry (OTEL) collector
- Prometheus metrics endpoint

---

## 3. Plugin Registration Models

### Model 1: Registry + Explicit Import (Current Approach)

**How it works:**
- During worker startup, explicitly import plugin modules
- Example: `import './portals/as-visa/index.js'` registers the driver

**Advantages:**
- Easy debugging
- Deterministic deployment
- Clear dependency tree

**Disadvantages:**
- Requires adding an import statement for each new plugin
- Not true compile-time "locking"—just a bootstrap list

**Example:**
```typescript
// apps/worker/src/index.ts
import './portals/as-visa';
import './portals/idata';
```

---

### Model 2: Auto-Discovery (Future Enhancement)

**How it works:**
- Configuration specifies enabled plugins: `enabledPlugins: ["as-visa", "idata"]`
- Lazy-load plugins dynamically: `await import(./portals/${id}/plugin.js)`

**Advantages:**
- True plugin behavior—unused portals are never loaded
- Dynamic plugin management without code changes

**Disadvantages:**
- Requires careful bundling, path resolution, and distribution setup
- More complex debugging

**Example:**
```typescript
// Dynamic loading
for (const pluginId of config.enabledPlugins) {
  const plugin = await import(`./portals/${pluginId}/plugin.js`);
  registerPortal(plugin.default);
}
```

---

## 4. Implementation Roadmap

**Phase 1:** Implement Model 1 (Registry + Explicit Import)
- Focus on stability and predictability
- Establish plugin contracts and interfaces
- Build portal, CAPTCHA, proxy, and storage plugins

**Phase 2:** Migrate to Model 2 (Auto-Discovery)
- Implement dynamic plugin loading
- Add lazy-loading capabilities
- Optimize for production deployment

---

## 5. Plugin Contract Example

Each plugin type should implement a specific interface:

```typescript
// Portal Plugin Contract
interface PortalDriver {
  id: string;
  name: string;
  version: string;
  initialize(config: PortalConfig): Promise<void>;
  run(job: Job): Promise<JobResult>;
  cleanup(): Promise<void>;
}

// CAPTCHA Solver Contract
interface CaptchaSolver {
  id: string;
  solve(type: CaptchaType, context: CaptchaContext): Promise<CaptchaSolution>;
}

// Proxy Provider Contract
interface ProxyProvider {
  id: string;
  getProxy(sessionKey: string): Promise<ProxyConfig>;
  releaseProxy(proxyId: string): Promise<void>;
  rotateProxy(sessionKey: string): Promise<ProxyConfig>;
}
```

---

## 6. Benefits of Plugin Architecture

1. **Extensibility:** Add new portals or strategies without modifying core code
2. **Maintainability:** Each plugin is isolated and independently testable
3. **Flexibility:** Switch implementations via configuration
4. **Scalability:** Load only the plugins needed for specific tenants or jobs
5. **Developer Experience:** Clear contracts make it easy to add new plugins

---

## 7. File Organization

```
apps/worker/src/
├── core/
│   ├── browser/
│   ├── networking/
│   │   └── proxy-manager.ts (Proxy Plugin Registry)
│   ├── anti-bot/
│   │   └── solver-registry.ts (CAPTCHA Plugin Registry)
│   ├── storage/
│   │   └── storage-adapter.ts (Storage Plugin Interface)
│   └── observability/
│       └── logger.ts (Observability Plugin)
├── portals/
│   ├── registry.ts (Portal Plugin Registry)
│   ├── types.ts (Portal Contracts)
│   ├── as-visa/
│   │   ├── index.ts (Portal Driver Implementation)
│   │   └── config.ts
│   └── idata/
│       ├── index.ts
│       └── config.ts
└── index.ts (Bootstrap & Plugin Loading)
```
