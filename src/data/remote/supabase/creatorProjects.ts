import { AppError } from '@/domain/errors/AppError';
import {
  CREATOR_ASPECT_RATIO,
  type CreatorProject,
  type CreatorProjectData,
  type CreatorProjectSummary,
  type CreatorFormat,
  type CreatorTemplateId,
} from '@/domain/models/creator';
import {
  isCreatorFormat,
  parseCreatorCaption,
  parseCreatorProjectName,
  parseCreatorProjectRow,
  parseCreatorProjectData,
  type CreatorProjectRow as RawCreatorProjectRow,
} from '@/features/creator/validation';
import { isCreatorTemplateId } from '@/features/creator/templates';
import { dataClient, type Json } from './client';

/**
 * Creator Studio drafts, owner-scoped through RLS on `creator_projects`.
 * Reads and writes go through `dataClient()` (Clerk-authed when a Clerk
 * session is live, else the Supabase session) so the studio shares the app's
 * single auth path. Rendered images never leave the device.
 */

interface CloudFailure { code?: string; message?: string; status?: number }

/** Mirrors the watch-state error mapping: auth/permission never reads as "offline". */
function cloudError(failure: CloudFailure | null | undefined, fallbackMessage: string): AppError {
  const code = String(failure?.code ?? '');
  const status = failure?.status;
  if (code === '42501' || code === 'PGRST301' || status === 401 || status === 403) {
    return new AppError('authentication', 'Your account isn’t allowed to open these drafts. Sign out, then sign in again.');
  }
  if (code === '42P01' || code === 'PGRST202' || status === 404) {
    return new AppError('configuration', 'Drafts aren’t ready for this account yet. You can still create and export on this device.');
  }
  return new AppError('network', fallbackMessage);
}

async function client() {
  try {
    return await dataClient();
  } catch {
    throw new AppError('configuration', 'Cloud drafts are not configured on this device.');
  }
}

const SUMMARY_COLUMNS = 'id,name,template_id,format,updated_at';
const FULL_COLUMNS = 'id,user_id,name,template_id,format,aspect_ratio,slide_data,caption,created_at,updated_at';

export interface SaveCreatorProjectInput {
  /** Present when updating an existing draft. */
  id?: string;
  userId: string;
  name: string;
  templateId: CreatorTemplateId;
  format: CreatorFormat;
  caption: string;
  data: CreatorProjectData;
}

export class SupabaseCreatorProjectsRepository {
  /** Draft summaries, newest first. Empty when the account has none. */
  async list(): Promise<CreatorProjectSummary[]> {
    const supabase = await client();
    const { data, error } = await supabase
      .from('creator_projects')
      .select(SUMMARY_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error || !data) throw cloudError(error, 'Could not load your drafts. Check your connection and try again.');
    return (data as Pick<RawCreatorProjectRow, 'id' | 'name' | 'template_id' | 'format' | 'updated_at'>[])
      .map((row) => {
        const name = parseCreatorProjectName(row.name);
        if (!name || !row.id || !isCreatorTemplateId(row.template_id) || !isCreatorFormat(row.format)) return null;
        return {
          id: row.id,
          name,
          templateId: row.template_id,
          format: row.format,
          updatedAt: row.updated_at,
        } as CreatorProjectSummary | null;
      })
      .filter((summary): summary is CreatorProjectSummary => summary !== null);
  }

  /** One full draft. Null when the row is gone or fails validation. */
  async get(id: string): Promise<CreatorProject | null> {
    const supabase = await client();
    const { data, error } = await supabase
      .from('creator_projects')
      .select(FULL_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) throw cloudError(error, 'Could not open that draft. Check your connection and try again.');
    if (!data) return null;
    const parsed = parseCreatorProjectRow(data as RawCreatorProjectRow);
    return parsed ?? null;
  }

  /** Inserts a new draft or updates an existing one, returning the stored row. */
  async save(input: SaveCreatorProjectInput): Promise<CreatorProject> {
    const name = parseCreatorProjectName(input.name);
    if (!name) throw new AppError('validation', 'Give your project a name first (up to 60 characters).');
    const slideData = parseCreatorProjectData(input.data);
    if (!slideData) throw new AppError('validation', 'This project’s slide data is incomplete and cannot be saved.');
    const caption = parseCreatorCaption(input.caption);
    const row = {
      user_id: input.userId,
      name,
      template_id: input.templateId,
      format: input.format,
      aspect_ratio: CREATOR_ASPECT_RATIO,
      slide_data: slideData as unknown as Json,
      caption,
    };
    const supabase = await client();
    const query = input.id
      ? supabase.from('creator_projects').update(row).eq('id', input.id).eq('user_id', input.userId)
      : supabase.from('creator_projects').insert(row);
    const { data, error } = await query.select(FULL_COLUMNS).single();
    if (error || !data) throw cloudError(error, 'Could not save this draft. Your changes are still open in the editor — try again when you’re back online.');
    const parsed = parseCreatorProjectRow(data as RawCreatorProjectRow);
    if (!parsed) throw new AppError('validation', 'The saved draft came back in an unexpected shape. Please try saving again.');
    return parsed;
  }

  async remove(id: string): Promise<void> {
    const supabase = await client();
    const { error } = await supabase.from('creator_projects').delete().eq('id', id);
    if (error) throw cloudError(error, 'Could not delete that draft. Check your connection and try again.');
  }
}

export const creatorProjectsRepository = new SupabaseCreatorProjectsRepository();
