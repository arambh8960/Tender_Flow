/**
 * Role permission matrix within a single organisation.
 *
 * Write access requires manager or above. viewer and member are read-only
 * for business data; admin and owner additionally administer the tenant.
 */
import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  admin,
  asUser,
  createTestUser,
  createTestOrg,
  addMember,
  cleanupTestData,
  disconnect,
} from '../helpers/rlsHarness.mjs';

const ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'];
const CAN_WRITE_BUSINESS = new Set(['owner', 'admin', 'manager']);
const CAN_ADMIN = new Set(['owner', 'admin']);

let org;
const users = {};
let seededSku;

before(async () => {
  await cleanupTestData();

  const ownerUser = await createTestUser('role-owner');
  users.owner = ownerUser;
  org = await createTestOrg(ownerUser.id, 'Roles Org');

  for (const role of ROLES.filter(r => r !== 'owner')) {
    const u = await createTestUser(`role-${role}`);
    users[role] = u;
    await addMember(org.id, u.id, role);
  }

  const r = await admin(
    `insert into public.inventory_items (organization_id, sku_id, product_name, available_quantity)
     values ($1, 'ROLE-SKU-1', 'Role Test Cable', 10) returning id`,
    [org.id]
  );
  seededSku = r.rows[0].id;
});

after(async () => {
  await cleanupTestData();
  await disconnect();
});

describe('Every role can read its own organisation', () => {
  for (const role of ROLES) {
    test(`${role} can SELECT inventory`, async () => {
      const r = await asUser(users[role].id, 'select id from public.inventory_items where organization_id = $1', [org.id]);
      assert.ok(r.rowCount >= 1, `${role} saw ${r.rowCount} rows`);
    });
  }
});

describe('Business writes require manager or above', () => {
  for (const role of ROLES) {
    const allowed = CAN_WRITE_BUSINESS.has(role);

    test(`${role} ${allowed ? 'CAN' : 'CANNOT'} INSERT inventory`, async () => {
      const run = () =>
        asUser(
          users[role].id,
          `insert into public.inventory_items (organization_id, sku_id, product_name)
           values ($1, $2, 'Attempted') returning id`,
          [org.id, `ROLE-INS-${role}`]
        );

      if (allowed) {
        const r = await run();
        assert.equal(r.rowCount, 1);
      } else {
        await assert.rejects(run, /row-level security/i);
      }
    });

    test(`${role} ${allowed ? 'CAN' : 'CANNOT'} UPDATE inventory`, async () => {
      const r = await asUser(
        users[role].id,
        'update public.inventory_items set available_quantity = 999 where id = $1 returning id',
        [seededSku]
      );
      assert.equal(r.rowCount, allowed ? 1 : 0);
    });

    test(`${role} ${allowed ? 'CAN' : 'CANNOT'} DELETE inventory`, async () => {
      const r = await asUser(users[role].id, 'delete from public.inventory_items where id = $1 returning id', [
        seededSku,
      ]);
      assert.equal(r.rowCount, allowed ? 1 : 0);
    });
  }
});

describe('Tenant administration requires admin or above', () => {
  for (const role of ROLES) {
    const allowed = CAN_ADMIN.has(role);

    test(`${role} ${allowed ? 'CAN' : 'CANNOT'} update the organization record`, async () => {
      const r = await asUser(users[role].id, `update public.organizations set industry = 'Changed' where id = $1 returning id`, [
        org.id,
      ]);
      assert.equal(r.rowCount, allowed ? 1 : 0);
    });

    test(`${role} ${allowed ? 'CAN' : 'CANNOT'} toggle a module`, async () => {
      const r = await asUser(
        users[role].id,
        `update public.organization_modules set enabled = false
         where organization_id = $1 and module_key = 'analytics' returning module_key`,
        [org.id]
      );
      assert.equal(r.rowCount, allowed ? 1 : 0);
    });

    test(`${role} ${allowed ? 'CAN' : 'CANNOT'} add a member`, async () => {
      const run = () =>
        asUser(
          users[role].id,
          `insert into public.organization_members (organization_id, user_id, role, status)
           values ($1, $2, 'member', 'active') returning id`,
          [org.id, users.viewer.id === users[role].id ? users.member.id : users.viewer.id]
        );

      if (allowed) {
        // Conflicts with the existing membership row, which still proves the
        // policy allowed the write through to the constraint.
        await assert.rejects(run, /duplicate key/i);
      } else {
        await assert.rejects(run, /row-level security/i);
      }
    });
  }
});

describe('Owner protection', () => {
  test('the last active owner cannot be demoted', async () => {
    await assert.rejects(
      () =>
        admin(`update public.organization_members set role = 'member'
                where organization_id = $1 and user_id = $2`, [org.id, users.owner.id]),
      /last active owner/i
    );
  });

  test('the last active owner cannot be removed', async () => {
    await assert.rejects(
      () =>
        admin('delete from public.organization_members where organization_id = $1 and user_id = $2', [
          org.id,
          users.owner.id,
        ]),
      /last active owner/i
    );
  });

  test('deleting the organisation itself is still permitted', async () => {
    const tmpUser = await createTestUser('role-temp-owner');
    const tmpOrg = await createTestOrg(tmpUser.id, 'Disposable Org');
    const r = await admin('delete from public.organizations where id = $1 returning id', [tmpOrg.id]);
    assert.equal(r.rowCount, 1);
  });
});

describe('Membership self-service', () => {
  test('a member may remove their own membership', async () => {
    const r = await asUser(
      users.member.id,
      'delete from public.organization_members where organization_id = $1 and user_id = $2 returning id',
      [org.id, users.member.id]
    );
    assert.equal(r.rowCount, 1);
  });

  test('a member may not remove someone else', async () => {
    const r = await asUser(
      users.member.id,
      'delete from public.organization_members where organization_id = $1 and user_id = $2 returning id',
      [org.id, users.viewer.id]
    );
    assert.equal(r.rowCount, 0);
  });
});
