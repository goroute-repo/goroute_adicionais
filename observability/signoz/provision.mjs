#!/usr/bin/env node
/**
 * Provisiona alertas, dashboard e saved views do GoRoute no SigNoz local.
 *
 * Uso:
 *   set SIGNOZ_API_KEY=<sua-chave>
 *   node observability/signoz/provision.mjs
 *
 * Opcional:
 *   SIGNOZ_URL=http://localhost:8080
 *   SIGNOZ_CHANNEL=goroute-local
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SIGNOZ_URL = (process.env.SIGNOZ_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const SIGNOZ_API_KEY = process.env.SIGNOZ_API_KEY ?? '';
const CHANNEL_NAME = process.env.SIGNOZ_CHANNEL ?? 'goroute-local';
const DASHBOARD_SLUG = 'goroute-overview';
const ONLY_DELETE_DASHBOARDS = process.argv.includes('--delete-dashboards');

if (!SIGNOZ_API_KEY) {
  console.error(
    'Defina SIGNOZ_API_KEY (Settings → API Keys no SigNoz em http://localhost:8080).',
  );
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'SIGNOZ-API-KEY': SIGNOZ_API_KEY,
};

async function api(method, path, body) {
  const res = await fetch(`${SIGNOZ_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}

function loadJson(dir, file) {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

function replaceChannel(obj) {
  return JSON.parse(JSON.stringify(obj).replaceAll('__CHANNEL__', CHANNEL_NAME));
}

/** SigNoz v2 list endpoints return { data: { dashboards|views|rules: [...] } }, not a bare array. */
function asList(res, key) {
  const data = res?.data ?? res;
  if (Array.isArray(data)) return data;
  if (key && Array.isArray(data?.[key])) return data[key];
  return [];
}

async function ensureChannel() {
  const list = await api('GET', '/api/v1/channels');
  const channels = list?.data ?? list ?? [];
  const exists = Array.isArray(channels) && channels.some((c) => c.name === CHANNEL_NAME);
  if (exists) {
    console.log(`✓ Canal de notificação "${CHANNEL_NAME}" já existe`);
    return;
  }

  await api('POST', '/api/v1/channels', {
    name: CHANNEL_NAME,
    webhook_configs: [
      {
        send_resolved: true,
        url: 'https://httpbin.org/post',
        http_config: { follow_redirects: true },
      },
    ],
  });
  console.log(`✓ Canal "${CHANNEL_NAME}" criado (webhook → httpbin.org/post para dev)`);
}

async function provisionAlerts() {
  const dir = join(__dirname, 'alerts');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  const existing = asList(await api('GET', '/api/v2/rules'), 'rules');
  const existingNames = new Set(existing.map((r) => r.alert ?? r.name));

  for (const file of files) {
    const rule = replaceChannel(loadJson(dir, file));
    const name = rule.alert;
    if (existingNames.has(name)) {
      console.log(`· Alerta já existe: ${name}`);
      continue;
    }
    await api('POST', '/api/v2/rules', rule);
    console.log(`✓ Alerta criado: ${name}`);
  }
}

function dashboardTitle(dashboard) {
  return (
    dashboard.spec?.display?.name ??
    dashboard.data?.spec?.display?.name ??
    dashboard.data?.title ??
    ''
  );
}

function dashboardSlug(dashboard) {
  return dashboard.name ?? dashboard.data?.name ?? '';
}

function isGorouteDashboard(dashboard) {
  const slug = dashboardSlug(dashboard);
  const title = dashboardTitle(dashboard);
  return (
    slug === DASHBOARD_SLUG ||
    slug.startsWith('goroute-') ||
    /goroute/i.test(title)
  );
}

function extractCorruptDashboardId(error) {
  const match = String(error).match(/dashboard ([0-9a-f-]{36}) is not in/);
  return match?.[1] ?? null;
}

async function listAllDashboardsV1() {
  const res = await api('GET', '/api/v1/dashboards');
  const list = res?.data ?? [];
  return Array.isArray(list) ? list : [];
}

async function listAllDashboardsV2() {
  const res = await api('GET', '/api/v2/dashboards?limit=200');
  return asList(res, 'dashboards');
}

async function listAllDashboards() {
  try {
    return { dashboards: await listAllDashboardsV2(), source: 'v2' };
  } catch (error) {
    const corruptId = extractCorruptDashboardId(error);
    if (corruptId) {
      console.log(`· Dashboard corrompido detectado (${corruptId}); usando API v1`);
    } else {
      console.log('· Listagem v2 falhou; usando API v1');
    }
    return { dashboards: await listAllDashboardsV1(), source: 'v1', corruptId };
  }
}

async function deleteDashboardById(id, label) {
  let deleted = false;
  try {
    await api('DELETE', `/api/v2/dashboards/${id}`);
    deleted = true;
  } catch {
    await api('DELETE', `/api/v1/dashboards/${id}`);
    deleted = true;
  }
  if (!deleted) {
    throw new Error(`Não foi possível remover dashboard ${id}`);
  }
  console.log(`✓ Dashboard removido (API): ${label} (${id})`);
}

async function verifyDashboardsRemoved(ids) {
  const remaining = await listAllDashboardsV1();
  const stillThere = remaining.filter((d) => ids.has(d.id));
  return stillThere;
}

async function deleteGorouteDashboards() {
  const { dashboards, corruptId } = await listAllDashboards();
  const targets = dashboards.filter(isGorouteDashboard);
  const ids = new Set(targets.map((d) => d.id));

  if (corruptId) {
    ids.add(corruptId);
  }

  if (ids.size === 0) {
    console.log('· Nenhum dashboard GoRoute para remover');
    return 0;
  }

  const byId = new Map(dashboards.map((d) => [d.id, d]));
  for (const id of ids) {
    const dashboard = byId.get(id);
    const label = dashboard ? dashboardTitle(dashboard) || dashboardSlug(dashboard) : 'dashboard-corrompido';
    await deleteDashboardById(id, label || id);
  }

  const stillThere = await verifyDashboardsRemoved(ids);
  if (stillThere.length > 0) {
    console.error('\nA API respondeu OK, mas o dashboard ainda está no banco (bug/org mismatch).');
    console.error('Execute no PowerShell:');
    console.error('  .\\observability\\signoz\\purge-dashboards-docker.ps1');
    console.error('Depois rode novamente: node observability/signoz/provision.mjs');
    throw new Error(`${stillThere.length} dashboard(s) não foram removidos`);
  }

  return ids.size;
}

async function provisionDashboard() {
  await deleteGorouteDashboards();

  const payload = loadJson(join(__dirname, 'dashboards'), 'goroute-overview.json');
  const created = await api('POST', '/api/v2/dashboards', payload);
  const id = created?.data?.id;
  const title = created?.data?.spec?.display?.name ?? payload.spec?.display?.name;
  console.log(`✓ Dashboard criado: ${title}`);
  if (id) {
    console.log(`  URL: ${SIGNOZ_URL}/dashboard/${id}`);
  }
}

async function provisionSavedViews() {
  const dir = join(__dirname, 'saved-views');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  for (const sourcePage of ['traces', 'logs']) {
    const listRes = await api('GET', `/api/v1/explorer/views?sourcePage=${sourcePage}`);
    const views = listRes?.data ?? [];
    const existingNames = new Set(views.map((v) => v.name));

    for (const file of files) {
      const view = loadJson(dir, file);
      if (view.sourcePage !== sourcePage) continue;
      if (existingNames.has(view.name)) {
        console.log(`· Saved view já existe: ${view.name}`);
        continue;
      }
      await api('POST', '/api/v1/explorer/views', view);
      console.log(`✓ Saved view criada: ${view.name}`);
    }
  }
}

async function provisionDashboardListView() {
  const name = 'GoRoute dashboards';
  const list = asList(await api('GET', '/api/v2/dashboard_views'), 'views');
  if (list.some((v) => v.name === name)) {
    console.log(`· Dashboard list view já existe: ${name}`);
    return;
  }
  await api('POST', '/api/v2/dashboard_views', {
    name,
    data: {
      version: 'v1',
      query: 'tag:team=goroute',
      sort: 'updated_at',
      order: 'desc',
    },
  });
  console.log(`✓ Dashboard saved view criada: ${name}`);
}

async function main() {
  console.log(`SigNoz: ${SIGNOZ_URL}`);

  if (ONLY_DELETE_DASHBOARDS) {
    await deleteGorouteDashboards();
    console.log('\nDashboards GoRoute removidos. Importe de novo pela UI ou rode sem --delete-dashboards.');
    return;
  }

  await ensureChannel();
  await provisionAlerts();
  await provisionSavedViews();
  await provisionDashboard();
  await provisionDashboardListView();
  console.log('\nConcluído. Atualize a Home do SigNoz — os passos 5–7 do checklist devem marcar como feitos.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
