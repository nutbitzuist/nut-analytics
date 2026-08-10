import { statSync } from 'node:fs';

const file = process.argv[2] || 'dist/worker.js';
const maxBytes = Number(process.env.CF_WORKER_MAX_GZIP_BYTES || 1_000_000);
const size = statSync(file).size;
console.log(JSON.stringify({ file, bytes: size, maxBytes, ok: size <= maxBytes }, null, 2));
if (size > maxBytes) process.exit(1);
