import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { creatorProjectsRepository, type SaveCreatorProjectInput } from '@/data/remote/supabase/creatorProjects';
import { useSessionStore } from '@/store/app/sessionStore';

/**
 * Creator Studio data hooks. Everything is gated on an authenticated session
 * (drafts are account-scoped through RLS), so guests never trigger requests.
 */

export const creatorKeys = {
  all: ['creator'] as const,
  projects: ['creator', 'projects'] as const,
  project: (id: string) => ['creator', 'projects', id] as const,
};

export function useCreatorProjects(enabled = true) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: creatorKeys.projects,
    queryFn: () => creatorProjectsRepository.list(),
    enabled: enabled && session.mode === 'authenticated',
    staleTime: 30_000,
    retry: 1,
  });
}

export function useCreatorProject(id: string | undefined) {
  const session = useSessionStore((state) => state.session);
  return useQuery({
    queryKey: id ? creatorKeys.project(id) : (['creator', 'projects', 'none'] as const),
    queryFn: () => (id ? creatorProjectsRepository.get(id) : Promise.resolve(null)),
    enabled: Boolean(id) && session.mode === 'authenticated',
    staleTime: 15_000,
    retry: 1,
  });
}

export function useSaveCreatorProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveCreatorProjectInput) => creatorProjectsRepository.save(input),
    onSuccess: (project) => {
      queryClient.setQueryData(creatorKeys.project(project.id), project);
      void queryClient.invalidateQueries({ queryKey: creatorKeys.projects });
    },
  });
}

export function useDeleteCreatorProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => creatorProjectsRepository.remove(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: creatorKeys.project(id) });
      void queryClient.invalidateQueries({ queryKey: creatorKeys.projects });
    },
  });
}
