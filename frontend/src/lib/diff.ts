/** A minimal unified-diff parser for `git diff` output. */

export type DiffLineKind = 'add' | 'del' | 'context' | 'meta';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface ParsedFile {
  path: string;
  oldPath: string | null;
  status: 'added' | 'deleted' | 'renamed' | 'modified';
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function stripPrefix(p: string): string {
  if (p === '/dev/null') return p;
  return p.replace(/^[ab]\//, '');
}

function pathFromGitHeader(line: string): { a: string; b: string } {
  // "diff --git a/foo b/foo" (paths with spaces are rare; take the halves around " b/")
  const rest = line.slice('diff --git '.length);
  const idx = rest.lastIndexOf(' b/');
  if (idx === -1) {
    const [a = '', b = ''] = rest.split(' ');
    return { a: stripPrefix(a), b: stripPrefix(b) };
  }
  return { a: stripPrefix(rest.slice(0, idx)), b: stripPrefix(rest.slice(idx + 1)) };
}

export function parseUnifiedDiff(patch: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  let file: ParsedFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const { a, b } = pathFromGitHeader(line);
      file = { path: b, oldPath: a !== b ? a : null, status: 'modified', binary: false, additions: 0, deletions: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from ')) {
        file.status = 'renamed';
        file.oldPath = line.slice('rename from '.length);
      } else if (line.startsWith('rename to ')) file.path = line.slice('rename to '.length);
      else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) file.binary = true;
      else if (line.startsWith('--- ')) {
        const p = stripPrefix(line.slice(4).trim());
        if (p === '/dev/null') file.status = 'added';
      } else if (line.startsWith('+++ ')) {
        const p = stripPrefix(line.slice(4).trim());
        if (p === '/dev/null') file.status = 'deleted';
        else file.path = p;
      }
    }

    const m = HUNK_RE.exec(line);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    if (line.startsWith('+')) {
      hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ });
      file.additions++;
    } else if (line.startsWith('-')) {
      hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null });
      file.deletions++;
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ kind: 'context', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else if (line.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', text: line, oldNo: null, newNo: null });
    }
  }
  return files;
}
