import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storageDir = path.resolve(__dirname, '../src/storage');
const schemaPath = path.join(storageDir, 'schema.sql');
const outPath = path.join(storageDir, 'schema_sql.ts');

const sql = fs.readFileSync(schemaPath, 'utf8').replace(/\r\n/g, '\n');
const escaped = sql.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const content = `// Auto-generated from core/src/storage/schema.sql by core/scripts/sync_schema_sql.mjs
// Do not edit manually.
export const EMBEDDED_SCHEMA_SQL = \`${escaped}\`;
`;

fs.writeFileSync(outPath, content, 'utf8');
console.log('[sync_schema_sql] Synced schema_sql.ts from schema.sql');
