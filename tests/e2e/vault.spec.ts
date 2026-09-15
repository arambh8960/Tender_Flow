import {
  test, expect, E2E_READY, SKIP_REASON, admin, E2E_ENV,
  createConfirmedUser, deleteUser, deleteOrganization, signIn, createCompany, uniqueSuffix,
  type TestUser,
} from './support/fixtures';
import { createClient } from '@supabase/supabase-js';

/**
 * FLOW E — the compliance vault on Supabase Storage.
 *
 * Two properties are under test and both are security properties: the bucket
 * is private, and an object is reachable only by the organisation whose id
 * prefixes its path. Storage RLS is the enforcement point, so these assertions
 * run against the real bucket rather than against our own path checks.
 */

const BUCKET = 'org-documents';

/** A minimal but genuinely valid PDF, so type validation sees a real file. */
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8'
);

test.describe('compliance vault', () => {
  test.skip(!E2E_READY, SKIP_REASON);

  let userA: TestUser;
  let userB: TestUser;
  let orgA: string;
  let orgB: string;
  let documentA: string;
  let pathA: string;

  test.beforeAll(async ({ browser }) => {
    userA = await createConfirmedUser('vault-a');
    userB = await createConfirmedUser('vault-b');

    const pageA = await browser.newPage();
    await signIn(pageA, userA);
    orgA = await createCompany(pageA, `E2E Vault A ${uniqueSuffix()}`);
    await pageA.close();

    const pageB = await browser.newPage();
    await signIn(pageB, userB);
    orgB = await createCompany(pageB, `E2E Vault B ${uniqueSuffix()}`);
    await pageB.close();

    // Company A owns one document.
    const { data: doc } = await admin()
      .from('compliance_documents')
      .insert({
        organization_id: orgA,
        cert_name: 'E2E ISO 9001',
        category: 'LEGAL',
        expiry_date: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10),
        uploaded_by: userA.id,
      })
      .select('id')
      .single();

    documentA = doc!.id;
    pathA = `${orgA}/${documentA}/iso-9001.pdf`;

    await admin().storage.from(BUCKET).upload(pathA, PDF_BYTES, { contentType: 'application/pdf', upsert: true });

    await admin()
      .from('compliance_documents')
      .update({
        storage_path: pathA,
        mime_type: 'application/pdf',
        file_size: PDF_BYTES.byteLength,
        file_name: 'iso-9001.pdf',
      })
      .eq('id', documentA);
  });

  test.afterAll(async () => {
    await admin().storage.from(BUCKET).remove([pathA]).catch(() => undefined);
    if (orgA) await deleteOrganization(orgA);
    if (orgB) await deleteOrganization(orgB);
    await deleteUser(userA.id);
    await deleteUser(userB.id);
  });

  test('the document bucket is private', async () => {
    const { data } = await admin().storage.getBucket(BUCKET);
    expect(data?.public, 'the document bucket is PUBLIC — every stored file is world-readable').toBe(false);
  });

  test('a public URL does not serve the object', async () => {
    const { data } = admin().storage.from(BUCKET).getPublicUrl(pathA);
    const response = await fetch(data.publicUrl);

    // A private bucket must refuse the unsigned URL.
    expect(response.ok).toBe(false);
    expect([400, 401, 403, 404]).toContain(response.status);
  });

  test('the owning company sees its document with an expiry status', async ({ page }) => {
    await signIn(page, userA);
    await page.goto('/admin/compliance');

    await expect(page.getByText('E2E ISO 9001').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/valid|expiring|expired/i).first()).toBeVisible();
  });

  test('the owner can mint a working signed URL', async () => {
    const asOwner = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    await asOwner.auth.signInWithPassword({ email: userA.email, password: userA.password });

    const { data, error } = await asOwner.storage.from(BUCKET).createSignedUrl(pathA, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();

    const response = await fetch(data!.signedUrl);
    expect(response.ok, 'the owner could not read their own document').toBe(true);
  });

  test('company B cannot read company A object, even knowing its exact path', async () => {
    const asOutsider = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    await asOutsider.auth.signInWithPassword({ email: userB.email, password: userB.password });

    // Storage RLS keys on the first path segment, which is company A's id.
    const { data, error } = await asOutsider.storage.from(BUCKET).createSignedUrl(pathA, 60);

    const denied = Boolean(error) || !data?.signedUrl;
    if (!denied) {
      const response = await fetch(data!.signedUrl);
      expect(response.ok, 'company B obtained a working URL for company A document').toBe(false);
    } else {
      expect(denied).toBe(true);
    }
  });

  test('company B cannot download company A object directly', async () => {
    const asOutsider = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    await asOutsider.auth.signInWithPassword({ email: userB.email, password: userB.password });

    const { data, error } = await asOutsider.storage.from(BUCKET).download(pathA);

    expect(data, 'company B downloaded company A document').toBeNull();
    expect(error).toBeTruthy();
  });

  test('company B cannot write into company A path prefix', async () => {
    const asOutsider = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    await asOutsider.auth.signInWithPassword({ email: userB.email, password: userB.password });

    const { error } = await asOutsider.storage
      .from(BUCKET)
      .upload(`${orgA}/${documentA}/injected.pdf`, PDF_BYTES, { contentType: 'application/pdf' });

    expect(error, 'company B wrote a file into company A storage prefix').toBeTruthy();
  });

  test('company B cannot read company A document metadata row', async () => {
    const asOutsider = createClient(E2E_ENV.supabaseUrl, E2E_ENV.anonKey);
    await asOutsider.auth.signInWithPassword({ email: userB.email, password: userB.password });

    const { data } = await asOutsider.from('compliance_documents').select('id').eq('id', documentA);

    // RLS filters rather than errors: the row is simply not visible.
    expect(data ?? []).toHaveLength(0);
  });

  test('company B vault screen shows nothing from company A', async ({ page }) => {
    await signIn(page, userB);
    await page.goto('/admin/compliance');

    await expect(page.getByText('E2E ISO 9001')).toHaveCount(0);
  });
});
