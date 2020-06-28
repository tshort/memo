import vscode, { workspace } from 'vscode';
import path from 'path';
export { sort as sortPaths } from 'cross-path-sort';
import fs from 'fs';

import { WorkspaceCache, RefT, FoundRefT } from '../types';

const allExtsRegex = /\.(md|png|jpg|jpeg|svg|gif)/;

const markdownExtRegex = /\.md$/;

const imageExtsRegex = /\.(png|jpg|jpeg|svg|gif)/;

export const refPattern = '(\\[\\[)([^\\[\\]]+?)(\\]\\])';

export const containsImageExt = (path: string): boolean => !!imageExtsRegex.exec(path);

export const containsMarkdownExt = (path: string): boolean => !!markdownExtRegex.exec(path);

export const trimLeadingSlash = (value: string) => value.replace(/^\/+|^\\+/g, '');
export const trimTrailingSlash = (value: string) => value.replace(/\/+|^\\+$/g, '');
export const trimSlashes = (value: string) => trimLeadingSlash(trimTrailingSlash(value));

export const isLongRef = (path: string) => path.split('/').length > 1;

export const extractLongRef = (
  basePathParam: string,
  pathParam: string,
  preserveExtension?: boolean,
): RefT | null => {
  const allExtsMatch = allExtsRegex.exec(pathParam);

  if (allExtsMatch) {
    const ref = pathParam.replace(basePathParam, '').replace(/\\/gi, '/');

    if (preserveExtension) {
      const [refStr, label = ''] = trimLeadingSlash(ref).split('|');

      return {
        ref: refStr,
        label,
      };
    }

    const refNoExts = trimLeadingSlash(ref.replace(allExtsRegex, ''));
    const [refStr, label = ''] = refNoExts.split('|');

    return {
      ref: refStr,
      label,
    };
  }

  return null;
};

export const extractShortRef = (pathParam: string, preserveExtension?: boolean): RefT | null => {
  const allExtsMatch = allExtsRegex.exec(pathParam);

  if (allExtsMatch) {
    const ref = path.basename(pathParam);

    if (preserveExtension) {
      const [refStr, label = ''] = trimLeadingSlash(ref).split('|');

      return {
        ref: refStr,
        label,
      };
    }

    const refNoExts = trimLeadingSlash(ref.replace(allExtsRegex, ''));
    const [refStr, label = ''] = refNoExts.split('|');

    return {
      ref: refStr,
      label,
    };
  }

  return null;
};

const workspaceCache: WorkspaceCache = {
  imageUris: [],
  markdownUris: [],
};

export const getWorkspaceCache = (): WorkspaceCache => workspaceCache;

export const cacheWorkspace = async () => {
  workspaceCache.imageUris = await workspace.findFiles('**/*.{png,jpg,jpeg,svg,gif}');
  workspaceCache.markdownUris = await workspace.findFiles('**/*.md');
};

export const cleanWorkspaceCache = () => {
  workspaceCache.imageUris = [];
  workspaceCache.markdownUris = [];
};

export const getWorkspaceFolder = () =>
  workspace.workspaceFolders && workspace.workspaceFolders[0].uri.fsPath;

export const getDateInYYYYMMDDFormat = () => new Date().toISOString().slice(0, 10);

const isEditor = (
  documentOrEditor: vscode.TextDocument | vscode.TextEditor,
): documentOrEditor is vscode.TextEditor =>
  'document' in documentOrEditor && documentOrEditor.document !== null;

export function getConfigProperty<T>(
  documentOrEditor: vscode.TextDocument | vscode.TextEditor,
  property: string,
  fallback: T,
): T {
  const document = isEditor(documentOrEditor) ? documentOrEditor.document : documentOrEditor;
  const config = vscode.workspace.getConfiguration('memo', document ? document.uri : undefined);
  return config.get(property.toLowerCase(), config.get(property, fallback));
}

export const matchAll = (pattern: RegExp, text: string): Array<RegExpMatchArray> => {
  const out: RegExpMatchArray[] = [];
  pattern.lastIndex = 0;
  let match: RegExpMatchArray | null;
  while ((match = pattern.exec(text))) {
    out.push(match);
  }
  return out;
};

export const getReferenceAtPosition = (
  document: vscode.TextDocument,
  position: vscode.Position,
): { range: vscode.Range; ref: string } | null => {
  const range = document.getWordRangeAtPosition(position, new RegExp(refPattern));

  if (!range) {
    return null;
  }

  const [ref] = document
    .getText(range)
    .replace('![[', '')
    .replace('[[', '')
    .replace(']]', '')
    .split('|');

  return {
    ref,
    range,
  };
};

export const findReferences = async (
  ref: string,
  excludePaths: string[] = [],
): Promise<FoundRefT[]> => {
  const refs: FoundRefT[] = [];

  for (const { fsPath } of workspaceCache.markdownUris) {
    if (excludePaths.includes(fsPath)) {
      continue;
    }

    const fileContent = fs.readFileSync(fsPath).toString();
    const matches = matchAll(new RegExp(`\\[\\[(${ref}(\\|.*)?)\\]\\]`, 'gi'), fileContent);

    if (matches.length) {
      const currentDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath));
      matches.forEach((match) => {
        const [, $1] = match;
        const offset = (match.index || 0) + 2;

        const refStart = currentDocument.positionAt(offset);
        const lineStart = currentDocument.lineAt(refStart);
        const matchText = lineStart.text.slice(
          Math.max(refStart.character - 2, 0),
          lineStart.text.length,
        );
        const refEnd = currentDocument.positionAt(offset + $1.length);

        refs.push({
          location: new vscode.Location(
            vscode.Uri.file(fsPath),
            new vscode.Range(refStart, refEnd),
          ),
          matchText: matchText,
        });
      });
    }
  }

  return refs;
};
