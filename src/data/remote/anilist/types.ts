export interface AniListMediaDto {
  id: number;
  idMal?: number | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  description?: string | null;
  coverImage?: { large?: string | null; extraLarge?: string | null } | null;
  bannerImage?: string | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  endDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  season?: string | null;
  seasonYear?: number | null;
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  duration?: number | null;
  genres?: (string | null)[] | null;
  averageScore?: number | null;
  popularity?: number | null;
  nextAiringEpisode?: { episode?: number | null; airingAt?: number | null } | null;
  airingSchedule?: {
    nodes?: ({ episode?: number | null; airingAt?: number | null } | null)[] | null;
  } | null;
  studios?: { nodes?: ({ name?: string | null } | null)[] | null } | null;
  relations?: {
    edges?: ({ relationType?: string | null; node?: AniListRelationNode | null } | null)[] | null;
  } | null;
}

export interface AniListRelationNode {
  id: number;
  idMal?: number | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  coverImage?: { large?: string | null } | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  nextAiringEpisode?: { episode?: number | null; airingAt?: number | null } | null;
}
export interface AniListResponse { data?: { Page?: { media?: (AniListMediaDto | null)[] | null; pageInfo?: { total?: number | null; perPage?: number | null; currentPage?: number | null; lastPage?: number | null; hasNextPage?: boolean | null } | null } | null; Media?: AniListMediaDto | null }; errors?: { message?: string }[] }
