const ANIME_FIELDS = `
  id idMal title { romaji english native } description
  coverImage { large extraLarge } bannerImage
  startDate { year month day } endDate { year month day } season seasonYear format status
  episodes duration genres averageScore popularity
  studios(isMain: true) { nodes { name } }
`;

/** Season chain for the detail screen only — list queries stay light. */
const ANIME_RELATIONS = `
  relations { edges { relationType node { id idMal title { romaji english native } format status episodes coverImage { large } startDate { year month day } } } }
`;

export const ANIME_SEARCH_QUERY = `
query SearchAnime($search: String!) {
  Page(page: 1, perPage: 20) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      ${ANIME_FIELDS}
    }
  }
}`;

export const ANIME_DETAIL_QUERY = `
query AnimeDetails($id: Int!) {
  Media(id: $id, type: ANIME) {
    ${ANIME_FIELDS}
    ${ANIME_RELATIONS}
  }
}`;

export const ANIME_TRENDING_QUERY = `
query TrendingAnime {
  Page(page: 1, perPage: 10) {
    media(type: ANIME, sort: TRENDING_DESC) {
      ${ANIME_FIELDS}
    }
  }
}`;

export const ANIME_UPCOMING_QUERY = `
query UpcomingAnime {
  Page(page: 1, perPage: 15) {
    media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) {
      ${ANIME_FIELDS}
    }
  }
}`;

export const ANIME_UPCOMING_PAGE_QUERY = `
query UpcomingAnimePage($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total perPage currentPage lastPage hasNextPage }
    media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) {
      ${ANIME_FIELDS}
    }
  }
}`;

export const ANIME_POPULAR_QUERY = `
query PopularAnime($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total perPage currentPage lastPage hasNextPage }
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      ${ANIME_FIELDS}
    }
  }
}`;

export const ANIME_RECENT_PAGE_QUERY = `
query RecentAnimePage($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total perPage currentPage lastPage hasNextPage }
    media(type: ANIME, sort: START_DATE_DESC, isAdult: false) {
      ${ANIME_FIELDS}
    }
  }
}`;

/** One genre shelf: exact AniList GenreCollection names (e.g. "Mystery"). */
export const ANIME_GENRE_PAGE_QUERY = `
query GenreAnimePage($page: Int!, $perPage: Int!, $genre: [String]) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total perPage currentPage lastPage hasNextPage }
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, genre_in: $genre) {
      ${ANIME_FIELDS}
    }
  }
}`;

export const ANIME_TOP_RATED_QUERY = `
query TopRatedAnime($page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total perPage currentPage lastPage hasNextPage }
    media(type: ANIME, sort: SCORE_DESC) {
      ${ANIME_FIELDS}
    }
  }
}`;

/**
 * The creator picker's anime rail: one query carrying every filter the UI
 * can combine (sort, genre, season year, status, popularity floor). Nullable
 * variables are simply omitted from the request — AniList applies no filter
 * for them.
 */
export const ANIME_SUGGEST_PAGE_QUERY = `
query SuggestAnimePage($page: Int!, $perPage: Int!, $sort: [MediaSort], $genre: [String], $seasonYear: Int, $status: MediaStatus, $popularityGreater: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total perPage currentPage lastPage hasNextPage }
    media(type: ANIME, sort: $sort, isAdult: false, genre_in: $genre, seasonYear: $seasonYear, status: $status, popularity_greater: $popularityGreater) {
      ${ANIME_FIELDS}
    }
  }
}`;
