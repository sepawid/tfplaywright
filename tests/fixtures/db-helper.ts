/**
 * KOD DO ANALIZY — NIE JEST SAMODZIELNIE URUCHAMIALNY W TYM REPOZYTORIUM
 *
 * Źródło: sepawid/jdg_nc_app @ commit d4776d7
 * Rola: Helper połączeniowy do tymczasowej bazy PostgreSQL weryfikujący bramki bezpieczeństwa.
 * Wymusza połączenie wyłącznie na interfejsie loopback (127.0.0.1 / localhost) oraz
 * jawną nazwę bazy zawierającą ciąg 'test' lub 'e2e' (zasada Fail-Closed).
 */

import { Client } from 'pg';

export function getSafeLoopbackDbUrl(): string {
  const rawUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error('[SECURITY GATE] Brak zdefiniowanej zmiennej TEST_DATABASE_URL / DATABASE_URL. Test odmawia startu (Fail-Closed).');
  }

  // Sterownik pg w Node.js wymaga czystego protokołu postgresql:// (odrzuca +psycopg)
  const normalized = rawUrl.replace(/^postgresql\+[a-zA-Z0-9_]+:\/\//, 'postgresql://');
  const parsed = new URL(normalized);

  if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    throw new Error(`[SECURITY GATE] Baza danych musi działać na loopbacku! Wykryto: ${parsed.hostname}`);
  }
  if (!parsed.pathname.toLowerCase().includes('test') && !parsed.pathname.toLowerCase().includes('e2e')) {
    throw new Error(`[SECURITY GATE] Baza danych musi być bazą testową (zawierać 'test' lub 'e2e' w nazwie)! Wykryto: ${parsed.pathname}`);
  }

  return normalized;
}

export async function createIsolatedDbClient(): Promise<Client> {
  const client = new Client({ connectionString: getSafeLoopbackDbUrl() });
  await client.connect();
  return client;
}
