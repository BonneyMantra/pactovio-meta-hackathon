import { ActionError, need, type ActionCtx, type ProviderActions } from '../actions';
import { b64ToBytes, bytesToB64, deepFind, deepFindArray, mimeFor } from '../util';

function payload(i: Record<string, any>, ctx: ActionCtx) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (ctx.file) return ctx.file;
  const filename = String(i.filename ?? '');
  if (!filename) throw new ActionError('filename is required', 'bad_input');
  if (typeof i.text !== 'string') throw new ActionError('Provide r2_key or text', 'bad_input');
  return { filename, mimetype: String(i.mimetype ?? mimeFor(filename)), bytes: new TextEncoder().encode(i.text) };
}

const SAMPLE = { filename: 'pactovio-connector-test.txt', text: 'Uploaded by the Pactovio connector test. Safe to delete.' };
const FOLDER = 'Pactovio';

async function driveFolder(ctx: ActionCtx): Promise<string | null> {
  const saved = ctx.meta.config?.folder_id as string | undefined;
  if (saved) return saved;
  const found = await ctx.exec('GOOGLEDRIVE_FIND_FILE', { q: `name = '${FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, pageSize: 1 });
  let id = deepFind((deepFindArray(found, ['files']) ?? [])[0], ['id']);
  if (!id) id = deepFind(await ctx.exec('GOOGLEDRIVE_CREATE_FOLDER', { name: FOLDER }), ['id']);
  if (id) await ctx.saveConfig({ folder_id: id });
  return id;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const quote = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
type DriveFile = { id?: string; name?: string; size?: string | number; mimeType?: string; modifiedTime?: string };
const driveFiles = (data: unknown) => ((deepFindArray(data, ['files']) ?? []) as DriveFile[]).filter((f) => f.id);

export const googledrive: ProviderActions = {
  list_folders: {
    summary: 'List Drive folders, optionally matching a name',
    run: async (i, ctx) => {
      const name = i.name ? ` and name contains '${quote(String(i.name))}'` : '';
      const data = await ctx.exec('GOOGLEDRIVE_FIND_FILE', { q: `mimeType = '${FOLDER_MIME}' and trashed = false${name}`, pageSize: 100, fields: 'files(id,name,modifiedTime)' });
      return { id: null, details: { folders: driveFiles(data).map((f) => ({ id: f.id, name: f.name ?? '', modified: f.modifiedTime ?? null })) } };
    },
    sample: () => ({}),
  },
  list_files: {
    summary: 'List the PDFs directly inside a Drive folder (all pages)',
    run: async (i, ctx) => {
      const folder = String(need(i.folder_id, 'folder_id'));
      if (!/^[\w-]{6,80}$/.test(folder)) throw new ActionError('folder_id is not a Drive folder id', 'bad_input');
      const out: { id: string; name: string; size: number }[] = [];
      let token: string | undefined;
      for (let page = 0; page < 10; page++) {
        const data = await ctx.exec('GOOGLEDRIVE_FIND_FILE', { q: `'${folder}' in parents and mimeType = 'application/pdf' and trashed = false`, pageSize: 100,
          fields: 'nextPageToken,files(id,name,size,mimeType)', ...(token ? { pageToken: token } : {}) });
        out.push(...driveFiles(data).map((f) => ({ id: String(f.id), name: f.name ?? String(f.id), size: Number(f.size ?? 0) })));
        token = deepFind(data, ['nextPageToken', 'next_page_token']) ?? undefined;
        if (!token) break;
      }
      return { id: folder, details: { files: out } };
    },
    sample: () => ({}),
  },
  download_file: {
    summary: 'Download one Drive PDF (base64, up to 8 MB)',
    run: async (i, ctx) => {
      const id = String(need(i.file_id, 'file_id'));
      let bytes: Uint8Array | null = null;
      try {
        const data = await ctx.exec('GOOGLEDRIVE_DOWNLOAD_FILE', { file_id: id });
        const href = deepFind(data, ['s3url', 's3_url', 'url']);
        if (href) { const r = await fetch(href); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); }
      } catch { /* fall back to the raw API below */ }
      if (!bytes) {
        const r = await ctx.proxy({ endpoint: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, method: 'GET', query: { alt: 'media' } });
        const b64 = typeof r.data === 'string' ? r.data : deepFind(r.data, ['data', 'content', 'base64']);
        if (r.status >= 400 || !b64) throw new ActionError(`Drive download failed (${r.status})`);
        bytes = b64ToBytes(b64);
      }
      if (bytes.length > 8_000_000) throw new ActionError('File is larger than 8 MB', 'bad_input');
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== '%PDF') throw new ActionError('Downloaded file is not a PDF');
      return { id, details: { base64: bytesToB64(bytes), bytes: bytes.length } };
    },
    sample: () => ({}),
  },
  upload_file: {
    summary: 'Upload a file into the Pactovio folder',
    run: async (i, ctx) => {
      const f = payload(i, ctx);
      const folder = await driveFolder(ctx);
      const staged = await ctx.stage('GOOGLEDRIVE_UPLOAD_FILE', f);
      const data = await ctx.exec('GOOGLEDRIVE_UPLOAD_FILE', { file_to_upload: staged, ...(folder ? { folder_to_upload_to: folder } : {}) });
      const id = deepFind(data, ['id', 'fileId']);
      return { id, url: deepFind(data, ['webViewLink', 'web_view_link']) ?? (id ? `https://drive.google.com/file/d/${id}/view` : null), details: { folder } };
    },
    readback: async (out, ctx) => !!out.id && deepFind(await ctx.exec('GOOGLEDRIVE_GET_FILE_METADATA', { fileId: out.id }), ['id']) !== null,
    cleanup: async (out, ctx) => { if (out.id) await ctx.exec('GOOGLEDRIVE_DELETE_FILE', { fileId: out.id }); },
    sample: () => SAMPLE,
  },
};

export const dropbox: ProviderActions = {
  upload_file: {
    summary: 'Upload a file into /Pactovio',
    run: async (i, ctx) => {
      const f = payload(i, ctx);
      const staged = await ctx.stage('DROPBOX_UPLOAD_FILE', f);
      const data = await ctx.exec('DROPBOX_UPLOAD_FILE', { path: `/${FOLDER}/${f.filename}`, content: staged, mode: 'add', autorename: true });
      const path = deepFind(data, ['path_display', 'path_lower']) ?? `/${FOLDER}/${f.filename}`;
      return { id: deepFind(data, ['id']) ?? path, url: `https://www.dropbox.com/home${path.split('/').slice(0, -1).join('/')}`, details: { path } };
    },
    readback: async (out, ctx) => !!out.details?.path && deepFind(await ctx.exec('DROPBOX_GET_METADATA', { path: out.details.path }), ['id', 'name']) !== null,
    cleanup: async (out, ctx) => { if (out.details?.path) await ctx.exec('DROPBOX_DELETE_FILE_OR_FOLDER', { path: out.details.path }); },
    sample: () => SAMPLE,
  },
};
