/**
 * 单实例协议测试辅助进程：
 * 成为主实例后写 readyMarker，然后存活 20s；
 * 收到次级实例通知时把负载写入 payloadMarker。
 * 用法: node singleton-child.cjs <port> <readyMarker> <payloadMarker>
 */
const fs = require('node:fs');
const { acquireSingleton } = require('../../dist/main/single-instance.js');

const port = Number(process.argv[2]);
const readyMarker = process.argv[3];
const payloadMarker = process.argv[4];

acquireSingleton(
  (payload) => {
    try {
      fs.appendFileSync(payloadMarker, JSON.stringify(payload) + '\n');
    } catch {
      /* 忽略 */
    }
  },
  port,
).then((singleton) => {
  if (!singleton.isPrimary) process.exit(3);
  try {
    fs.writeFileSync(readyMarker, 'ready\n');
  } catch {
    process.exit(4);
  }
  setTimeout(() => process.exit(0), 20_000);
});
