/**
 * KOD DO ANALIZY — NIE JEST SAMODZIELNIE URUCHAMIALNY W TYM REPOZYTORIUM
 *
 * Źródło: sepawid/jdg_nc_app @ commit d4776d7
 * Rola: Fixtura bazowa Playwright rozszerzająca kontekst testowy o Circuit Breaker.
 * Blokuje wszelkie żądania mutujące (POST, PUT, DELETE, PATCH) poza interfejsem loopback (127.0.0.1 / localhost),
 * chroniąc przed przypadkowym uderzeniem w środowiska zewnętrzne lub stagingowe.
 */

import { test as base, expect, APIRequestContext } from '@playwright/test';

export interface ExtendedFixtures {
  verifyPageMutationBlocked: (action: () => Promise<void>) => Promise<void>;
}

export function resolveTargetUrl(urlOrPath: string, baseURL?: string): URL {
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    return new URL(urlOrPath);
  }
  return new URL(urlOrPath, baseURL || 'http://127.0.0.1');
}

export function isProtectedUrl(url: URL | string, baseURL?: string): boolean {
  try {
    const parsed = typeof url === 'string' ? resolveTargetUrl(url, baseURL) : url;
    const host = parsed.hostname.toLowerCase();
    // Dozwolone do mutacji są interfejs loopback oraz publiczne środowisko demonstracyjne ager.pl
    if (host === '127.0.0.1' || host === 'localhost') {
      return false;
    }
    if ((host === 'ager.pl' || host === 'www.ager.pl') && process.env.ALLOW_DEMO_MUTATIONS !== 'false') {
      return false;
    }
    // Każdy inny host (np. chroniona-domena-zewnetrzna.pl, domeny publiczne, staging) jest BEZWZGLĘDNIE chroniony
    return true;
  } catch {
    return true; // Fail-closed w razie błędu parsowania
  }
}

export function shouldBlockMutation(
  urlOrPath: string,
  baseURL: string | undefined,
  projectName: string | undefined
): { block: boolean; resolvedUrl: string } {
  if (projectName === 'smoke') {
    let resolved = urlOrPath;
    try {
      resolved = resolveTargetUrl(urlOrPath, baseURL).href;
    } catch {}
    return { block: true, resolvedUrl: resolved };
  }
  try {
    const resolved = resolveTargetUrl(urlOrPath, baseURL);
    const block = isProtectedUrl(resolved);
    return { block, resolvedUrl: resolved.href };
  } catch {
    return { block: true, resolvedUrl: urlOrPath };
  }
}

// Ochrona globalnego Node.js fetch przed przypadkowymi mutacjami w procesie testowym
if (typeof globalThis.fetch === 'function' && !(globalThis.fetch as any).__isCircuitBreakerPatched) {
  const originalFetch = globalThis.fetch;
  const safeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (
      init?.method ||
      (typeof input === 'object' && 'method' in input ? (input as any).method : 'GET') ||
      'GET'
    ).toUpperCase();

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as any).url || '';
      if (isProtectedUrl(urlStr)) {
        throw new Error(
          `[CIRCUIT BREAKER] Global mutating fetch '${method} ${urlStr}' is strictly forbidden against non-local / protected environment!`
        );
      }
      // Wyłączenie automatycznych przekierowań dla żądań mutujących (redirect: 'error')
      const safeInit: RequestInit = { ...init, redirect: 'error' };
      return originalFetch(input, safeInit);
    }
    return originalFetch(input, init);
  };
  (safeFetch as any).__isCircuitBreakerPatched = true;
  globalThis.fetch = safeFetch;
}

export function wrapRequestContext(
  context: APIRequestContext,
  baseURL?: string,
  projectName?: string
): APIRequestContext {
  const checkRedirect = (response: any, reqMethod: string, resolvedUrl: string) => {
    if (response && typeof response.status === 'function') {
      const status = response.status();
      if (status >= 300 && status < 400) {
        const location = response.headers ? response.headers()['location'] : undefined;
        if (location && isProtectedUrl(location, baseURL)) {
          throw new Error(
            `[CIRCUIT BREAKER] Mutating API call '${reqMethod.toUpperCase()} ${resolvedUrl}' received redirect (HTTP ${status}) to protected target '${location}'!`
          );
        }
      }
    }
    return response;
  };

  const handler: ProxyHandler<APIRequestContext> = {
    get(target, prop, receiver) {
      const method = String(prop).toLowerCase();

      // A. Blokada dedykowanych metod mutujących (post, put, delete, patch)
      if (['post', 'put', 'delete', 'patch'].includes(method)) {
        return async (url: string, options?: any) => {
          const check = shouldBlockMutation(url, baseURL, projectName);
          if (check.block) {
            throw new Error(
              `[CIRCUIT BREAKER] Mutating API call '${method.toUpperCase()} ${check.resolvedUrl}' is strictly forbidden against non-local / protected environment!`
            );
          }
          // Wyłączenie automatycznych przekierowań dla mutacji (maxRedirects = 0)
          const safeOptions = { ...options, maxRedirects: 0 };
          const orig = Reflect.get(target, prop, receiver);
          const response = await (typeof orig === 'function' ? orig.apply(target, [url, safeOptions]) : orig);
          return checkRedirect(response, method, check.resolvedUrl);
        };
      }

      // B. Blokada metody fetch z parametrem method wskazującym na mutację
      if (method === 'fetch') {
        return async (urlOrRequest: any, options?: any) => {
          const reqMethod = (
            options?.method ||
            (typeof urlOrRequest === 'object' && urlOrRequest?.method ? urlOrRequest.method : 'GET')
          ).toUpperCase();

          if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(reqMethod)) {
            const rawUrl = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest?.url || '';
            const check = shouldBlockMutation(rawUrl, baseURL, projectName);
            if (check.block) {
              throw new Error(
                `[CIRCUIT BREAKER] Mutating API call 'FETCH ${reqMethod} ${check.resolvedUrl}' is strictly forbidden against non-local / protected environment!`
              );
            }
            // Wyłączenie automatycznych przekierowań dla mutacji (maxRedirects = 0)
            const safeOptions = { ...options, maxRedirects: 0 };
            const orig = Reflect.get(target, prop, receiver);
            const response = await (typeof orig === 'function' ? orig.apply(target, [urlOrRequest, safeOptions]) : orig);
            return checkRedirect(response, `FETCH ${reqMethod}`, check.resolvedUrl);
          }
          const orig = Reflect.get(target, prop, receiver);
          return typeof orig === 'function' ? orig.apply(target, [urlOrRequest, options]) : orig;
        };
      }

      const orig = Reflect.get(target, prop, receiver);
      return typeof orig === 'function' ? orig.bind(target) : orig;
    },
  };

  return new Proxy(context, handler);
}

export const test = base.extend<ExtendedFixtures>({
  // 1. Ochrona przeglądarki (page) - dynamiczna ocena każdego pojedynczego żądania
  context: async ({ context, baseURL }, use, testInfo) => {
    // Opakowanie context.request
    const wrappedContextRequest = wrapRequestContext(context.request, baseURL, testInfo.project.name);
    Object.defineProperty(context, 'request', {
      get() {
        return wrappedContextRequest;
      },
      configurable: true,
    });

    await use(context);
  },

  page: async ({ page, baseURL }, use, testInfo) => {
    const unexpectedMutations: string[] = [];

    // Opakowanie page.request (oraz page.context().request)
    const wrappedPageRequest = wrapRequestContext(page.request, baseURL, testInfo.project.name);
    Object.defineProperty(page, 'request', {
      get() {
        return wrappedPageRequest;
      },
      configurable: true,
    });

    // Flaga określająca, czy w danym momencie wykonywana jest kontrolowana sonda
    (page as any).__isProbingMutation = false;

    // Rejestracja uniwersalnego interceptora dla WSZYSTKICH projektów
    await page.route('**', (route) => {
      const method = route.request().method();
      const url = route.request().url();

      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        const check = shouldBlockMutation(url, baseURL, testInfo.project.name);
        if (check.block) {
          const record = `${method} ${check.resolvedUrl}`;
          const isProbing = (page as any).__isProbingMutation === true;
          if (!isProbing) {
            unexpectedMutations.push(record);
          }
          console.warn(`[CIRCUIT BREAKER] Zablokowano próbę mutacji w przeglądarce: ${record} (sonda: ${isProbing})`);
          return route.abort('blockedbyclient');
        }
      }
      return route.continue();
    });

    await use(page);

    // Po zakończeniu testu weryfikujemy brak jakichkolwiek NIEOCZEKIWANYCH mutacji chronionych
    expect(
      unexpectedMutations,
      `[CIRCUIT BREAKER] Wykryto nieoczekiwane próby mutacji w page: ${unexpectedMutations.join(', ')}`
    ).toHaveLength(0);
  },

  // 2. Ochrona kontekstu API (request) - Proxy aktywne zawsze, oceniające docelowy URL każdego wywołania
  request: async ({ request, baseURL }, use, testInfo) => {
    const safeContext = wrapRequestContext(request, baseURL, testInfo.project.name);
    await use(safeContext);
  },

  // 3. Ochrona fabryki nowych kontekstów API (playwright.request.newContext)
  playwright: [
    async ({ playwright }, use, workerInfo) => {
      const origNewContext = playwright.request.newContext.bind(playwright.request);
      playwright.request.newContext = async (options) => {
        const ctx = await origNewContext(options);
        return wrapRequestContext(ctx, options?.baseURL, workerInfo.project.name);
      };
      await use(playwright);
    },
    { scope: 'worker' },
  ],

  // 4. Precyzyjny helper badający blokadę bez globalnego wyłączania ochrony
  verifyPageMutationBlocked: async ({ page }, use) => {
    await use(async (action: () => Promise<void>) => {
      (page as any).__isProbingMutation = true;
      let aborted = false;

      const listener = (req: any) => {
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method())) {
          if (req.failure()?.errorText?.includes('ERR_BLOCKED_BY_CLIENT')) {
            aborted = true;
          }
        }
      };

      page.on('requestfailed', listener);
      try {
        await action();
      } finally {
        (page as any).__isProbingMutation = false;
        page.off('requestfailed', listener);
      }

      expect(aborted, 'Żądanie mutujące w przeglądarce musi zostać zablokowane przez route.abort(blockedbyclient)').toBe(true);
    });
  },
});

export { expect };
