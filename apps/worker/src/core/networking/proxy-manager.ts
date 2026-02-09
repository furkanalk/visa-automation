import type { PortalProxy, ProxyProvider } from '../../config/types.js';

export interface ProxyEndpoint {
  server: string;        // e.g. http://host:port  OR socks5://host:port
  username?: string;
  password?: string;
  provider?: string;
}

export class ProxyManager {
  constructor(private proxy: PortalProxy) {}

  pick(): ProxyEndpoint | undefined {
    if (!this.proxy.enabled || this.proxy.strategy === 'off') return undefined;

    // MVP: static = first endpoint of first provider
    const p = this.proxy.providers[0];
    if (!p) return undefined;

    const ep = p.endpoints[0];
    if (!ep) return undefined;

    return {
      server: normalizeServer(p, ep),
      username: p.username,
      password: p.password,
      provider: p.name,
    };
  }
}

function normalizeServer(p: ProxyProvider, endpoint: string): string {
  // allow either "host:port" or full scheme url
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://') || endpoint.startsWith('socks5://')) {
    return endpoint;
  }
  const scheme = p.type === 'socks5' ? 'socks5://' : 'http://';
  return `${scheme}${endpoint}`;
}