export interface AnimeResult {
  title: string;
  url: string;
  cover?: string;
  id: string;
}

export interface EpisodeResult {
  title: string;
  url: string;
  id: string;
}

export interface VideoSource {
  quality: string;
  url: string;
}

// Interface que todo provedor (site de animes da vida real) deve seguir
export abstract class AnimeProvider {
  // Nome original do site (ex: AnimeFire, AnimesVision)
  abstract name: string;

  // Busca animes pelo nome
  abstract search(query: string): Promise<AnimeResult[]>;

  // Retorna os detalhes de um anime e a lista de episódios
  abstract getEpisodes(id: string): Promise<{ title: string; synopsis: string; cover: string; episodes: EpisodeResult[] }>;

  // Magia do scraping/puppeteer para retornar a URL final do video (.mp4/.m3u8)
  // Recebe o ID do episódio (ex: naruto/1)
  abstract extractVideoLinks(episodeId: string): Promise<VideoSource[]>;
}
