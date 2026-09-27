import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handleSuperBotRoute } from '../dist/superbot.js';

test('une mission reste en cours jusqu’à confirmation, sans double livraison', async () => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    handleSuperBotRoute(req, res, url.pathname, url).catch((error) => {
      res.writeHead(500); res.end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/superbot`;
  const post = (path, value) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  }).then((response) => response.json());
  const get = (path) => fetch(base + path).then((response) => response.json());
  try {
    const call = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'superbot_submit_publication', arguments: { platform: 'TikTok', scheduledAt: Date.now() + 3600000 } } });
    const id = JSON.parse(call.result.content[0].text).commandId;
    const first = (await get('/device/commands?deviceId=superbot-phone')).commands;
    assert.equal(first.length, 1);
    assert.equal(first[0].id, id);
    assert.deepEqual((await get('/device/commands?deviceId=superbot-phone')).commands, []);
    await post(`/device/commands/${id}/result`, { ok: true, phase: 'accepted', message: 'publication_dispatched' });
    const status = async () => {
      const answer = await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'superbot_get_task_status', arguments: { commandId: id } } });
      return JSON.parse(answer.result.content[0].text);
    };
    assert.equal((await status()).status, 'running');
    await post(`/device/commands/${id}/result`, { ok: true, phase: 'completed', message: 'scheduled_confirmed' });
    assert.equal((await status()).status, 'completed');
    await post(`/device/commands/${id}/result`, { ok: true, phase: 'accepted' });
    assert.equal((await status()).status, 'completed');
    assert.deepEqual((await get('/device/commands?deviceId=superbot-phone')).commands, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
