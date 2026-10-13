import type { CheckResult } from '../types.ts';

export type RestOutcome = { status: number; namespaces: string[] | null } | { error: string };

/**
 * REST API reachability at the discovered root (or /wp-json/).
 * - JSON index with namespaces -> ok (warn when wp/v2 is missing)
 * - HTTP 401/403 -> warn (deliberately restricted for anonymous visitors)
 * - anything else, including HTML error pages -> fail
 */
export function evaluateRest(outcome: RestOutcome): CheckResult {
  if ('error' in outcome) {
    return { id: 'rest', status: 'fail', summary: 'error', message: `REST API request failed: ${outcome.error}` };
  }
  const { status, namespaces } = outcome;
  if (status === 401 || status === 403) {
    return {
      id: 'rest',
      status: 'warn',
      summary: `${status}`,
      message: `REST API index returned HTTP ${status}; it is restricted for anonymous requests.`,
    };
  }
  if (status !== 200 || namespaces === null) {
    const what = status === 200 ? 'a response that is not a REST API index' : `HTTP ${status}`;
    return { id: 'rest', status: 'fail', summary: `${status}`, message: `REST API index returned ${what}.` };
  }
  if (!namespaces.includes('wp/v2')) {
    return {
      id: 'rest',
      status: 'warn',
      summary: 'no wp/v2',
      message: `REST API is reachable but the wp/v2 namespace is missing (${namespaces.length} namespaces).`,
    };
  }
  return { id: 'rest', status: 'ok', summary: 'ok', message: `REST API reachable (${namespaces.length} namespaces).` };
}
