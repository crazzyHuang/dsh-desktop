import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stripAnsi, parseWebUrlLine, backoffDelay } = require('../../dist/main/dsh.js');
const { mergeSettings } = require('../../dist/main/settings.js');

test('stripAnsi 移除终端转义', () => {
  assert.equal(stripAnsi('\x1b[32mok\x1b[0m'), 'ok');
  assert.equal(stripAnsi('plain'), 'plain');
});

test('parseWebUrlLine 解析官方 URL 行', () => {
  assert.equal(parseWebUrlLine('dsh web: http://127.0.0.1:3080\n'), 'http://127.0.0.1:3080');
  assert.equal(
    parseWebUrlLine('\x1b[32mdsh web:\x1b[0m http://192.168.1.8:4321'),
    'http://192.168.1.8:4321',
  );
});

test('parseWebUrlLine 兜底匹配回环地址', () => {
  assert.equal(parseWebUrlLine('listening http://127.0.0.1:9999 ...'), 'http://127.0.0.1:9999');
});

test('parseWebUrlLine 无 URL 时返回 null', () => {
  assert.equal(parseWebUrlLine('hello world'), null);
});

test('backoffDelay 指数退避并封顶 30s', () => {
  assert.equal(backoffDelay(0), 1000);
  assert.equal(backoffDelay(1), 1000);
  assert.equal(backoffDelay(2), 2000);
  assert.equal(backoffDelay(3), 4000);
  assert.equal(backoffDelay(5), 16000);
  assert.equal(backoffDelay(6), 30000);
  assert.equal(backoffDelay(20), 30000);
});

test('mergeSettings 缺省值', () => {
  const s = mergeSettings(null);
  assert.equal(s.host, '127.0.0.1');
  assert.equal(s.port, 3080);
  assert.equal(s.attachExisting, true);
  assert.equal(s.minimizeToTray, true);
  assert.deepEqual(s.dshArgs, []);
  assert.equal(s.cwd, null);
});

test('mergeSettings 部分合并', () => {
  const s = mergeSettings({ port: 9999, notifications: false });
  assert.equal(s.port, 9999);
  assert.equal(s.notifications, false);
  assert.equal(s.host, '127.0.0.1'); // 未提供字段保持默认
});

test('mergeSettings 拒绝非法值', () => {
  const s = mergeSettings({
    port: 'abc',
    host: 42,
    attachExisting: 'yes',
    dshArgs: ['--a', 1, null],
    cwd: '',
    dshBin: '',
  });
  assert.equal(s.port, 3080);
  assert.equal(s.host, '127.0.0.1');
  assert.equal(s.attachExisting, true);
  assert.deepEqual(s.dshArgs, ['--a']);
  assert.equal(s.cwd, null);
  assert.equal(s.dshBin, null);
});

test('mergeSettings 端口边界', () => {
  assert.equal(mergeSettings({ port: 0 }).port, 0);
  assert.equal(mergeSettings({ port: 65535 }).port, 65535);
  assert.equal(mergeSettings({ port: -1 }).port, 3080);
  assert.equal(mergeSettings({ port: 65536 }).port, 3080);
});
