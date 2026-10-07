import { Platform, Share } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

export type SaveResult = 'shared' | 'saved' | 'downloaded' | 'cancelled';

/** "nudge-brightline-fixtures-2026-10-07.json" */
export function exportFileName(orgName: string, now = new Date()) {
  const slug =
    orgName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workspace';
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `nudge-${slug}-${d}.json`;
}

/**
 * Hands an export to the person:
 *   iOS     — writes it to the app's cache and opens the share sheet (Save to Files, AirDrop, Mail…);
 *             the cached copy is removed once the sheet closes.
 *   Android — the share sheet can't carry a file without extra modules, so the system folder picker
 *             opens and the file is saved where they choose.
 *   Web     — a normal browser download.
 */
export async function saveExport(json: string, fileName: string): Promise<SaveResult> {
  if (Platform.OS === 'web') {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) throw new Error('Downloads aren’t available here');
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = fileName;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'downloaded';
  }

  if (Platform.OS === 'ios') {
    const file = new File(Paths.cache, fileName);
    file.create({ overwrite: true });
    file.write(json);
    try {
      const r = await Share.share({ url: file.uri, title: fileName });
      return r.action === Share.dismissedAction ? 'cancelled' : 'shared';
    } finally {
      try {
        if (file.exists) file.delete();
      } catch {
        // cache is cleared by the OS eventually
      }
    }
  }

  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch {
    return 'cancelled';
  }
  const out = dir.createFile(fileName, 'application/json');
  out.write(json);
  return 'saved';
}
