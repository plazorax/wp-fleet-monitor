import { summarize } from '../src/run.ts';
import type { FleetReport, SiteResult } from '../src/types.ts';
import { NOW } from './helpers.ts';

export const HEALTHY: SiteResult = {
  name: 'Blog',
  url: 'https://blog.example/',
  tags: [],
  status: 'ok',
  checks: [
    { id: 'http', status: 'ok', summary: '200 120 ms', message: 'HTTP 200 in 120 ms.' },
    { id: 'tls', status: 'ok', summary: '80 days', message: 'Certificate valid until 2027-01-01.' },
    { id: 'wordpress', status: 'ok', summary: '7.1.3', message: 'Core 7.1.3 is up to date.' },
    { id: 'rest', status: 'ok', summary: 'ok', message: 'REST API reachable (12 namespaces).' },
  ],
};

export const OUTDATED: SiteResult = {
  name: 'Shop | EU',
  url: 'https://shop.example/',
  tags: ['shop'],
  status: 'warn',
  checks: [
    { id: 'http', status: 'ok', summary: '200 340 ms', message: 'HTTP 200 in 340 ms.' },
    { id: 'tls', status: 'warn', summary: '12 days', message: 'Certificate expires in 12 days (2026-10-25).' },
    {
      id: 'wordpress',
      status: 'unknown',
      summary: 'hidden',
      message: 'WordPress detected (rest-link) but the core version is not public.',
    },
    { id: 'rest', status: 'ok', summary: 'ok', message: 'REST API reachable (30 namespaces).' },
    { id: 'plugin:akismet', status: 'ok', summary: '5.7.2', message: 'Installed 5.7.2 is up to date.' },
    {
      id: 'plugin:woocommerce',
      status: 'warn',
      summary: '10.1 < 10.2',
      message: 'Installed 10.1 is behind 10.2 on WordPress.org.',
    },
  ],
};

export const DOWN: SiteResult = {
  name: 'Old site',
  url: 'https://old.example/',
  tags: [],
  status: 'fail',
  checks: [
    { id: 'http', status: 'fail', summary: 'down', message: 'Request failed: ENOTFOUND old.example' },
    { id: 'tls', status: 'fail', summary: 'error', message: 'TLS handshake failed: ENOTFOUND old.example' },
    { id: 'wordpress', status: 'skip', summary: '-', message: 'Skipped: home page unreachable.' },
    { id: 'rest', status: 'skip', summary: '-', message: 'Skipped: home page unreachable.' },
  ],
};

export function report(...sites: SiteResult[]): FleetReport {
  return summarize(sites, NOW);
}
