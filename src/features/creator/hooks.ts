import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { creatorDraftRepository, type SaveCreatorDraftInput } from '@/data/local/repositories/SqliteCreatorDraftRepository';

/**
 * Creator Studio draft hooks. Drafts are device-local SQLite rows — there is
 * no account and no network involved, so every hook runs unconditionally and
 * failures surface as "this device" messages from the repository.
 */

export const creatorKeys = {
  all: ['creator'] as const,
  drafts: ['creator', 'drafts'] as const,
  draft: (id: string) => ['creator', 'drafts', id] as const,
};

export function useCreatorDrafts(enabled = true) {
  return useQuery({
    queryKey: creatorKeys.drafts,
    queryFn: () => creatorDraftRepository.list(),
    enabled,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useCreatorDraft(id: string | undefined) {
  return useQuery({
    queryKey: id ? creatorKeys.draft(id) : (['creator', 'drafts', 'none'] as const),
    queryFn: () => (id ? creatorDraftRepository.get(id) : Promise.resolve(null)),
    enabled: Boolean(id),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useSaveCreatorDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveCreatorDraftInput) => creatorDraftRepository.save(input),
    onSuccess: (project) => {
      queryClient.setQueryData(creatorKeys.draft(project.id), project);
      void queryClient.invalidateQueries({ queryKey: creatorKeys.drafts });
    },
  });
}

export function useDeleteCreatorDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => creatorDraftRepository.remove(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: creatorKeys.draft(id) });
      void queryClient.invalidateQueries({ queryKey: creatorKeys.drafts });
    },
  });
}
