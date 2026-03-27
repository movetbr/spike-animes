export interface AnimeResult {
  id: string;          // Slug único (ex: solo-leveling)
  title: string;
  cover: string;       // URL da imagem
  url?: string;        // URL original do site
  type?: string;       // Anime, Movie, OVA
  year?: string;
  score?: string;      // 0.0 a 10.0
  provider: string;    // De qual site veio
}

export interface EpisodeResult {
  id: string;          // Slug do episódio (ex: solo-leveling-1x1)
  title: string;
  url: string;
  number?: number;     // Número real do episódio
}

export interface VideoSource {
  quality: string;
  url: string;
  status?: string;
  type?: string;       // embed, direct, m3u8
}

export interface HomeSection {
  title: string;
  items: AnimeResult[];
}

export interface HomeData {
  featured?: AnimeResult;
  sections: HomeSection[];
}

// Interface que todo provedor (site de animes da vida real) deve seguir
export abstract class AnimeProvider {
  // Nome original do site (ex: AnimeFire, AnimesOnlineCC)
  abstract name: string;
  abstract baseUrl: string;

  // Busca animes pelo nome
  abstract search(query: string): Promise<AnimeResult[]>;

  // Retorna os detalhes de um anime e a lista de episódios
  abstract getEpisodes(id: string): Promise<{ 
    title: string; 
    synopsis: string; 
    cover: string; 
    episodes: EpisodeResult[];
    genres?: string[];
    score?: string;
    year?: string;
    status?: string;
  }>;

  // Extração de vídeo
  abstract extractVideoLinks(episodeId: string): Promise<VideoSource[]>;

  // Dados da página inicial
  abstract getHome(): Promise<HomeData>;
}
