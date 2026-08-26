/**
 * Load CSV/TSV registration sheets.
 */
import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';

export const RegistrationRowSchema = z.object({
  profile_id: z.string().default('default'),
  url: z.string().min(1),
  email: z.string().optional().default(''),
  password: z.string().optional().default(''),
  name: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  company: z.string().optional().default(''),
  website: z.string().optional().default(''),
  message: z.string().optional().default(''),
  extra_json: z.string().optional().default(''),
});

export type RegistrationRow = z.infer<typeof RegistrationRowSchema>;

const ALIASES: Record<string, keyof RegistrationRow> = {
  profile_id: 'profile_id',
  profile: 'profile_id',
  profileid: 'profile_id',
  url: 'url',
  link: 'url',
  email: 'email',
  mail: 'email',
  password: 'password',
  pass: 'password',
  name: 'name',
  full_name: 'name',
  fullname: 'name',
  phone: 'phone',
  tel: 'phone',
  company: 'company',
  website: 'website',
  site: 'website',
  message: 'message',
  comment: 'message',
  extra_json: 'extra_json',
  extra: 'extra_json',
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

export function loadSheet(filePath: string): RegistrationRow[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  const delimiter = filePath.endsWith('.tsv') || raw.includes('\t') && !raw.includes(',') ? '\t' : ',';

  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    delimiter,
  }) as Record<string, string>[];

  return records.map((rec, i) => {
    const mapped: Record<string, string> = {};
    for (const [key, value] of Object.entries(rec)) {
      const norm = normalizeHeader(key);
      const field = ALIASES[norm];
      if (field) mapped[field] = value ?? '';
    }
    const parsed = RegistrationRowSchema.safeParse(mapped);
    if (!parsed.success) {
      throw new Error(`Row ${i + 1} invalid: ${parsed.error.message}`);
    }
    if (!parsed.data.url) {
      throw new Error(`Row ${i + 1}: url is required`);
    }
    return parsed.data;
  });
}

/** HH / Russian forms: ASCII quotes, short dash, -> */
export function sanitizeRuFormText(text: string): string {
  return text
    .replace(/[«»„“”]/g, '"')
    .replace(/[—–−]/g, '-')
    .replace(/→/g, '->');
}

export function parseExtraJson(extra: string): Record<string, string> {
  if (!extra?.trim()) return {};
  try {
    const obj = JSON.parse(extra) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[k] = String(v ?? '');
      }
      return out;
    }
  } catch (e) {
    console.warn('[sheet] extra_json parse failed:', e);
  }
  return {};
}
