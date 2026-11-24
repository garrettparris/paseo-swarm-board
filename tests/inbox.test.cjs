const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readNativeApprovals } = require('../server/inbox.ts');
const { inboxItem } = require('../shared/inbox.ts');

test('queues pending approvals across pages and excludes hidden sessions', async () => {
  const entry = (id, overrides = {}) => ({
    agent: { id, title: id, pendingPermissions: [{}, {}], ...overrides },
  });
  const paseo = { agents: { list: async ({ page }) => page.cursor ? {
    entries: [entry('one'), entry('two')],
    pageInfo: { nextCursor: null },
  } : {
    entries: [
      entry('one'),
      entry('hidden', { background: true }),
      entry('archived', { archivedAt: 'yesterday' }),
      entry('ready', { pendingPermissions: [] }),
    ],
    pageInfo: { nextCursor: 'next' },
  } } };
  const output = (await readNativeApprovals(paseo)).map((item) => inboxItem.parse(item));
  assert.deepEqual(output, [
    { agentId: 'one', title: 'one', request: { kind: 'approval', count: 2 } },
    { agentId: 'two', title: 'two', request: { kind: 'approval', count: 2 } },
  ]);
});
