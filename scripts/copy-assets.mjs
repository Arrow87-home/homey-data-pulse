import fs from 'node:fs';
for (const path of ['app.json', 'assets', 'settings']) {
  fs.cpSync(path, `.homeybuild/${path}`, { recursive: true });
}
