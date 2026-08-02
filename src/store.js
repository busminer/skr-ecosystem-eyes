import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class EventStore {
  constructor(file = path.resolve('data/events.json'), limit = Number(process.env.EVENT_LIMIT || 20_000)) {
    this.file = file;
    this.limit = limit;
  }

  async load() {
    try {
      const payload = JSON.parse(await readFile(this.file, 'utf8'));
      return Array.isArray(payload.events) ? payload.events : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async save(events) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const payload = JSON.stringify({ version: 1, savedAt: Math.floor(Date.now() / 1000), events: events.slice(0, this.limit) });
    await writeFile(temporary, payload);
    await rename(temporary, this.file);
  }
}
