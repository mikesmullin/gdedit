import { readdirSync, readFileSync } from 'fs';
import { join, extname, relative } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const ONTOLOGY_EXTENSIONS = new Set(['.yml', '.yaml', '.md']);

export function isOntologyStorageFile(filePath) {
  return ONTOLOGY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export function listOntologyFiles(storagePath) {
  const result = [];

  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isOntologyStorageFile(fullPath)) {
        result.push(fullPath);
      }
    }
  }

  walk(storagePath);
  return result;
}

function splitFrontmatter(content) {
  if (!content.startsWith('---\n')) {
    return { frontmatter: '', body: content };
  }

  const endIndex = content.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { frontmatter: '', body: content };
  }

  return {
    frontmatter: content.slice(4, endIndex),
    body: content.slice(endIndex + 5)
  };
}

export function parseStorageFileContent(filePath, content) {
  const extension = extname(filePath).toLowerCase();

  if (extension === '.md') {
    const { frontmatter, body } = splitFrontmatter(content);
    if (!frontmatter.trim()) {
      return { docs: [], body };
    }

    const parsed = parseYaml(frontmatter);
    return {
      docs: parsed ? [parsed] : [],
      body
    };
  }

  const docs = content
    .split(/^---$/m)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => parseYaml(s))
    .filter(Boolean);

  return { docs, body: '' };
}

export function parseStorageFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  return parseStorageFileContent(filePath, content);
}

export function serializeStorageFileContent(filePath, docs, body = '') {
  const extension = extname(filePath).toLowerCase();
  const nonNullDocs = (docs || []).filter(Boolean);

  if (extension === '.md') {
    const firstDoc = nonNullDocs[0] || {};
    const frontmatter = stringifyYaml(firstDoc).trimEnd();
    return `---\n${frontmatter}\n---\n${body || ''}`;
  }

  return nonNullDocs.map(d => stringifyYaml(d).trim()).join('\n---\n') + '\n';
}

export function getRelativeStoragePath(storagePath, filePath) {
  return relative(storagePath, filePath).replace(/\\/g, '/');
}

export function extractWikiLinks(body) {
  const relations = [];
  const seen = new Set();
  const regex = /\[\[([^\]]+)\]\]/g;

  let match;
  while ((match = regex.exec(body)) !== null) {
    if (match.index > 0 && body[match.index - 1] === '!') {
      continue;
    }

    const token = (match[1] || '').trim();
    if (!token) continue;

    const noAlias = token.split('|')[0].trim();
    const noAnchor = noAlias.split('#')[0].trim();
    const parts = noAnchor.split('/').filter(Boolean);
    if (parts.length < 2) continue;

    const className = parts[parts.length - 2];
    const id = parts[parts.length - 1];
    const key = `${className}/${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    relations.push({ className, id });
  }

  return relations;
}
