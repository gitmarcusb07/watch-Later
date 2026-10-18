import { AppError } from '@/domain/errors/AppError';
import {
  CREATOR_ASPECT_RATIO,
  type CreatorFormat,
  type CreatorProject,
  type CreatorProjectData,
  type CreatorProjectSummary,
  type CreatorTemplateId,
} from '@/domain/models/creator';
import { getDatabase } from '@/data/local/database/database';
import { isCreatorTemplateId } from '@/features/creator/templates';
import {
  formatMaxSlides,
  isCreatorFormat,
  parseCreatorCaption,
  parseCreatorProjectData,
  parseCreatorProjectName,
} from '@/features/creator/validation';

/**
 * Creator Studio drafts live only on this device, in the app's SQLite file.
 * No account, no network: saving works offline by design, and deleting the
 * app (or the "clear data" flow) removes drafts with it. Every read parses
 * the stored JSON through the same defensive parser the editor loads with,
 * so a corrupt row can never crash the studio.
 */

interface CreatorDraftRow {
  id: string;
  name: string;
  template_id: string;
  format: string;
  caption: string;
  slide_data: string;
  created_at: string;
  updated_at: string;
}

const SUMMARY_COLUMNS = 'id, name, template_id, format, updated_at';
const DRAFT_LIMIT = 200;

let draftCounter = 0;

/** Client-side draft id. Unique per device session; stored as the primary key. */
function newDraftId(): string {
  draftCounter += 1;
  return `d${Date.now().toString(36)}-${draftCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function parseStoredDraft(row: CreatorDraftRow): CreatorProject | null {
  if (!row.id || !isCreatorTemplateId(row.template_id) || !isCreatorFormat(row.format)) return null;
  const name = parseCreatorProjectName(row.name);
  if (!name) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(row.slide_data);
  } catch {
    return null;
  }
  const data = parseCreatorProjectData(raw, formatMaxSlides(row.format));
  if (!data) return null;
  return {
    id: row.id,
    name,
    templateId: row.template_id,
    format: row.format,
    aspectRatio: CREATOR_ASPECT_RATIO,
    caption: parseCreatorCaption(row.caption),
    data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SaveCreatorDraftInput {
  /** Present when updating an existing draft. */
  id?: string;
  name: string;
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  caption: string;
  data: CreatorProjectData;
}

export class SqliteCreatorDraftRepository {
  /** Draft summaries, newest first. Empty when the device has none. */
  async list(): Promise<CreatorProjectSummary[]> {
    try {
      const database = await getDatabase();
      const rows = await database.getAllAsync<Pick<CreatorDraftRow, 'id' | 'name' | 'template_id' | 'format' | 'updated_at'>>(
        `SELECT ${SUMMARY_COLUMNS} FROM creator_drafts ORDER BY updated_at DESC LIMIT ?`,
        DRAFT_LIMIT,
      );
      return rows
        .map((row) => {
          const name = parseCreatorProjectName(row.name);
          if (!name || !row.id || !isCreatorTemplateId(row.template_id) || !isCreatorFormat(row.format)) return null;
          return { id: row.id, name, templateId: row.template_id, format: row.format, updatedAt: row.updated_at } as CreatorProjectSummary;
        })
        .filter((summary): summary is CreatorProjectSummary => summary !== null);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('database', 'Could not open your drafts on this device. Please try again.', { cause: error });
    }
  }

  /** One full draft. Null when the row is gone or fails validation. */
  async get(id: string): Promise<CreatorProject | null> {
    try {
      const database = await getDatabase();
      const row = await database.getFirstAsync<CreatorDraftRow>('SELECT * FROM creator_drafts WHERE id = ?', id);
      return row ? parseStoredDraft(row) : null;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('database', 'Could not open that draft. Please try again.', { cause: error });
    }
  }

  /** Inserts a new draft or updates an existing one, returning the stored row. */
  async save(input: SaveCreatorDraftInput): Promise<CreatorProject> {
    const name = parseCreatorProjectName(input.name);
    if (!name) throw new AppError('validation', 'Give your project a name first (up to 60 characters).');
    const slideData = parseCreatorProjectData(input.data, formatMaxSlides(input.format));
    if (!slideData) throw new AppError('validation', 'This project’s slide data is incomplete and cannot be saved.');
    const caption = parseCreatorCaption(input.caption);
    const id = input.id ?? newDraftId();
    const now = new Date().toISOString();
    try {
      const database = await getDatabase();
      await database.runAsync(
        `INSERT INTO creator_drafts (id, name, template_id, format, caption, slide_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           template_id = excluded.template_id,
           format = excluded.format,
           caption = excluded.caption,
           slide_data = excluded.slide_data,
           updated_at = excluded.updated_at`,
        id, name, input.templateId, input.format, caption, JSON.stringify(slideData), now, now,
      );
      const stored = await this.get(id);
      if (!stored) throw new AppError('database', 'The saved draft could not be read back. Please try saving again.');
      return stored;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('database', 'Could not save this draft on this device. Your changes are still open in the editor — try again.', { cause: error });
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const database = await getDatabase();
      await database.runAsync('DELETE FROM creator_drafts WHERE id = ?', id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('database', 'Could not delete that draft. Please try again.', { cause: error });
    }
  }
}

export const creatorDraftRepository = new SqliteCreatorDraftRepository();
