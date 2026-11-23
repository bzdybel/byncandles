import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../worker/config/appConfig.ts';
import { checkPrerequisites } from '../../worker/config/prerequisites.ts';
import type { Env } from '../../worker/config/env.ts';
import { CatalogService } from '../../worker/services/CatalogService.ts';
import { expectResponse } from '../../worker/utils/providerHttp.ts';
import { ProviderError } from '../../worker/errors/AppError.ts';
import * as z from 'zod/mini';
import { assets, CATALOG, CONFIG } from './helpers.ts';

const env = (vars: Record<string, string | undefined>) => ({ ASSETS: assets(), DB: {}, ...vars }) as unknown as Env;
const P24 = { P24_MERCHANT_ID: '11111', P24_API_KEY: 'k', P24_CRC: 'c' };

test('konfiguracja: poprawne P24/ShipX/Resend → prawdziwi dostawcy, puste wartości = brak', () => {
  const c = loadConfig(env({ ...P24, SHIPX_TOKEN: 't', SHIPX_ORG_ID: '1', SHIPX_PARCEL: 'medium', RESEND_API_KEY: 'r', MAIL_FROM: 'a <a@b.pl>', SHOP_EMAIL: 'sklep@b.pl', SANDBOX: '1' }));
  assert.equal(c.payments.kind, 'przelewy24');
  assert.equal(c.payments.kind === 'przelewy24' && c.payments.config.posId, 11111, 'POS = merchant, gdy brak');
  assert.equal(c.shipping.kind === 'shipx' && c.shipping.config.parcelTemplate, 'medium');
  assert.equal(c.email.kind, 'resend');
  assert.deepEqual(c.issues, []);
  assert.equal(loadConfig(env({ ...P24, P24_CRC: '   ' })).payments.kind, 'missing');
});

test('konfiguracja: niepoprawne wartości ignorowane z opisem; zły klucz P24 blokuje zamówienia', () => {
  const c = loadConfig(env({ ...P24, P24_MERCHANT_ID: 'abc', SHIPX_TOKEN: 't', SHIPX_ORG_ID: '1', SHIPX_PARCEL: 'mały', SHOP_EMAIL: 'nie-email', ADMIN_PASSWORD: 'krótkie' }));
  assert.deepEqual(c.payments, { kind: 'missing', missing: ['P24_MERCHANT_ID'] });
  assert.equal(c.shipping.kind === 'shipx' && c.shipping.config.parcelTemplate, 'small', 'zła wartość → domyślna');
  assert.equal(c.shopEmail, undefined);
  assert.deepEqual(c.issues.map((i) => i.split(':')[0]).sort(), ['P24_MERCHANT_ID', 'SHIPX_PARCEL', 'SHOP_EMAIL']);
  const r = checkPrerequisites(c);
  assert.equal(r.passed, false);
  assert.ok(r.warnings.some((w) => w.includes('SHIPX_PARCEL')));
  assert.ok(r.warnings.some((w) => w.includes('ADMIN_PASSWORD krótsze')));
});

test('kontrakt z dostawcą: nieoczekiwany kształt odpowiedzi → ProviderError z listą niezgodności', () => {
  const schema = z.object({ id: z.string() });
  assert.deepEqual(expectResponse('x', 'send', { ok: true, status: 200, json: { id: 'a' } }, schema), { id: 'a' });
  assert.throws(
    () => expectResponse('x', 'send', { ok: true, status: 200, json: { id: 5 } }, schema),
    (e: unknown) => e instanceof ProviderError && JSON.stringify(e.details).includes('id: '),
  );
  assert.throws(
    () => expectResponse('shipx', 'create', { ok: false, status: 422, json: { error: 'validation_failed', details: {} } }, schema),
    (e: unknown) => e instanceof ProviderError && /HTTP 422 validation_failed/.test(e.message),
    'komunikat dostawcy w treści błędu (trafia do e-maila sklepu)',
  );
});

test('kontrakt z buildem: katalog i konfiguracja sprawdzane schematem', async () => {
  const ok = new CatalogService(assets(), 'https://x');
  assert.deepEqual(await ok.catalog(), CATALOG);
  assert.deepEqual(await ok.config(), CONFIG);
  const broken = new CatalogService(assets({ roza: ['Róża', '40 zł', 2, '/x/'] } as never), 'https://x');
  await assert.rejects(broken.catalog(), /katalog\.json/);
});
