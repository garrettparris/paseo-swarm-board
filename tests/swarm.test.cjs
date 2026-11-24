const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { openSwarmBoard } = require('../server/board.ts');
const { launchTool, readModels, reportTool, selectModel, startLead } = require('../server/launch.ts');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-board-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'board.json');
  const models = join(dir, 'models.json');
  const board = openSwarmBoard(file);
  const labels = new Map();
  const snapshots = new Map();
  const deliveries = [];
  const launches = [];
  const paseo = {
    agents: {
      ref(id) {
        return {
          id,
          address: { agentId: id, serverId: 'host' },
          async refresh() {
            const agent = snapshots.get(id) ?? (labels.has(id) ? { labels: labels.get(id) } : null);
            return agent ? { agent } : null;
          },
          async send(text, options) {
            deliveries.push({ id, text, options });
          },
        };
      },
    },
    workspaces: {
      ref(id) {
        return {
          agents: { async create(options) {
            launches.push({ workspaceId: id, ...options });
            return { id: `launch-${launches.length}` };
          } },
        };
      },
    },
  };
  function attach(id, role, name, parentId, parentHost = 'host', extra = {}) {
    const tags = { 'swarm/role': role, 'swarm/member': name, ...extra };
    if (parentId) {
      tags['paseo.parent-agent-id'] = parentId;
      tags['paseo.parent-server-id'] = parentHost;
    }
    const member = board.attach({ agentId: id, labels: tags }, 'Review checkout', paseo);
    labels.set(id, tags);
    return member;
  }
  const context = (id) => ({ agent: { id, workspaceId: 'workspace' }, paseo });
  return { file, models, board, paseo, attach, context, deliveries, labels, snapshots, launches };
}

test('keeps runs isolated, records posts durably, and addresses teammates by name', async (t) => {
  const f = fixture(t);
  f.attach('lead-a', 'lead', 'lead', 'source-a');
  const { tools: [read, post] } = f.attach('review-a', 'verifier', 'review', 'lead-a');
  f.attach('lead-b', 'lead', 'lead', 'source-b');
  f.attach('review-b', 'verifier', 'review', 'lead-b');

  const result = await post.execute({ text: 'PASS at abc123', mention: ['lead', 'lead'] }, f.context('review-a'));
  assert.deepEqual(result.structuredContent, { sequence: 1, notificationFailures: [] });
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].id, 'lead-a');
  assert.equal(f.deliveries[0].options.activeTurnBehavior, 'queue');
  assert.equal(f.deliveries[0].options.sourceAgentId, 'review-a');
  assert.equal(f.deliveries[0].text.includes('abc123'), false);
  assert.equal(read.execute({ after: 0 }, f.context('review-a')).structuredContent.posts[0].text, 'PASS at abc123');
  assert.equal(read.execute({ after: 1 }, f.context('review-a')).structuredContent.posts.length, 0);
  assert.throws(() => read.execute({}, f.context('review-b')), /different session/);
  assert.equal(f.board.view('lead-b').selected.posts.length, 0);
  assert.equal(openSwarmBoard(f.file).view('lead-a').selected.posts.length, 1);

  f.labels.delete('lead-a');
  const unavailable = await post.execute({ text: 'Follow-up', mention: ['lead'] }, f.context('review-a'));
  assert.deepEqual(unavailable.structuredContent, { sequence: 2, notificationFailures: ['lead'] });
  assert.equal(openSwarmBoard(f.file).view('lead-a').selected.posts.length, 2);
  await assert.rejects(post.execute({ text: 'Wrong name', mention: ['somebody'] }, f.context('review-a')), /named board member/);
});

test('enforces two spawning layers and unique names per run', (t) => {
  const f = fixture(t);
  f.attach('lead', 'lead', 'lead', 'dispatcher');
  f.attach('specialist', 'specialist', 'frontend', 'lead');
  f.attach('worker', 'worker', 'styles', 'specialist');
  assert.throws(() => f.attach('loop', 'lead', 'lead', 'lead'), /named parent/);
  assert.throws(() => f.attach('too-deep', 'worker', 'another', 'worker'), /named parent/);
  assert.throws(() => f.attach('outside', 'specialist', 'outside', 'lead', 'other-host'), /named parent/);
  assert.throws(() => f.attach('duplicate', 'verifier', 'frontend', 'lead'), /unique/);
  assert.doesNotThrow(() => f.attach('specialist', 'specialist', 'frontend', 'lead'));
});

test('launches in the source workspace and applies model overrides before saved defaults', async (t) => {
  const f = fixture(t);
  const codex = { provider: 'codex', model: 'build-model', thinkingOptionId: 'medium', workspaceId: 'workspace', labels: {} };
  const review = { provider: 'claude/review-model', thinkingOptionId: 'high' };
  const override = { provider: 'codex/verify-model' };
  assert.deepEqual(readModels(f.models), {});
  writeFileSync(f.models, JSON.stringify({ verifier: review }));
  assert.equal(selectModel(override, review, codex), override);
  assert.deepEqual(selectModel(undefined, undefined, codex), { provider: 'codex/build-model', thinkingOptionId: 'medium' });
  f.snapshots.set('source', codex);
  f.snapshots.set('lead', codex);

  const lead = await startLead(f.paseo, 'source', 'Review checkout\nStay read-only.', readModels(f.models));
  assert.deepEqual(lead, { leadId: 'launch-1' });
  assert.equal(f.launches[0].workspaceId, 'workspace');
  assert.equal(f.launches[0].parent.id, 'source');
  assert.equal(f.launches[0].labels['swarm/work'], 'Review checkout');

  const membership = f.attach('lead', 'lead', 'lead', 'source');
  const launch = launchTool(membership, 'lead', 'Review checkout', f.board, f.models);
  const result = await launch.execute({ name: 'verify', role: 'verifier', brief: 'Review diff abc123.' }, f.context('lead'));
  assert.equal(result.structuredContent.provider, 'claude/review-model');
  assert.equal(f.launches[1].parent.id, 'lead');
  await assert.rejects(launch.execute({ name: 'worker', role: 'worker', brief: 'Edit button.' }, f.context('lead')), /Only the specialist/);
  assert.equal(f.launches.length, 2);
});

test('a planner raises a durable question and a run inherits its existing Linear issue', async (t) => {
  const f = fixture(t);
  const issue = 'https://linear.app/example/issue/APP-42/retry';
  const source = { provider: 'codex', model: 'model', workspaceId: 'workspace', labels: {} };
  f.snapshots.set('source', source);

  await startLead(f.paseo, 'source', `${issue} Plan checkout retry`, {}, 'planning');
  const { labels, prompt } = f.launches[0];
  assert.equal(labels['swarm/issue'], issue);
  assert.equal(labels['swarm/stage'], 'planning');
  assert.match(prompt, /Elephant & Goldfish Model/);
  f.attach('plan', 'lead', 'lead', 'source', 'host', labels);
  f.snapshots.set('plan', { ...source, labels });
  assert.throws(() => f.attach('bad', 'specialist', 'bad', 'plan'), /named parent/);

  const report = reportTool('plan', f.labels.get('plan'), f.board);
  const context = f.context('plan');
  const ref = context.paseo.agents.ref;
  context.paseo = { agents: { ref: (id) => ({ ...ref(id), send: async () => { throw new Error('offline'); } }) } };
  const summary = 'Where should retry happen?\nChoose inline or restart.';
  assert.match((await report.execute({ status: 'needs-user', summary }, context)).text, /Decision saved/);
  assert.deepEqual(openSwarmBoard(f.file).view('plan').selected.issue, { url: issue, identifier: 'APP-42' });
  assert.equal(openSwarmBoard(f.file).view('plan').selected.decision.summary, summary);
  assert.equal(f.board.decisions()[0].request.summary, summary);
  assert.equal(f.board.decisions()[0].request.issue.identifier, 'APP-42');
  await assert.rejects(report.execute({ status: 'needs-user', summary: 'A second question' }, context), /open decision/);
  await report.execute({ status: 'decision-resolved', summary: 'Inline retry' }, context);
  assert.equal(openSwarmBoard(f.file).view('plan').selected.decision, undefined);
  assert.deepEqual(f.board.decisions(), []);

  await startLead(f.paseo, 'plan', 'Run the approved plan', {});
  assert.equal(f.launches[1].labels['swarm/issue'], issue);
  assert.equal(f.launches[1].labels['swarm/stage'], 'execution');
  assert.doesNotThrow(() => f.attach('run', 'lead', 'lead', 'plan', 'host', { 'swarm/stage': 'execution' }));
  assert.equal(f.board.view('run').selected.stage, 'execution');
});
