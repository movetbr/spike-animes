import axios from 'axios';
import { AnimeProvider, AnimeResult, HomeData, HomeSection, EpisodeResult, VideoSource } from './BaseProvider';

export class JikanProvider {
  name = 'Jikan';
  baseUrl = 'https://api.jikan.moe/v4';

  private async fetch(endpoint: string, params: any = {}) {
    try {
      const { data } = await axios.get(`${this.baseUrl}${endpoint}`, { params });
      return data;
    } catch (error: any) {
      console.error(`[Jikan Error] ${endpoint}: ${error.message}`);
      return null;
    }
  }

  // Mapeia o objeto da Jikan para o nosso AnimeResult padronizado
  private mapAnime(item: any): AnimeResult {
    return {
      id: item.mal_id.toString(),
      title: item.title_english || item.title,
      cover: item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url || '',
      type: item.type,
      year: item.year?.toString() || item.aired?.from?.split('-')[0],
      score: item.score?.toString() || '0.0',
      provider: this.name
    };
  }

  async getHome(): Promise<HomeData> {
    const sections: HomeSection[] = [];

    // 1. Top Anime (Populares de sempre)
    const topData = await this.fetch('/top/anime', { limit: 15 });
    if (topData?.data) {
      sections.push({
        title: 'Mais Populares (Global)',
        items: topData.data.map((item: any) => this.mapAnime(item))
      });
    }

    // 2. Seasonal Anime (Temporada Atual)
    const seasonalData = await this.fetch('/seasons/now', { limit: 15 });
    if (seasonalData?.data) {
      sections.push({
        title: 'Destaques da Temporada',
        items: seasonalData.data.map((item: any) => this.mapAnime(item))
      });
    }

    // 3. Upcoming (Em breve)
    const upcomingData = await this.fetch('/seasons/upcoming', { limit: 10 });
    if (upcomingData?.data) {
      sections.push({
        title: 'Em Breve',
        items: upcomingData.data.map((item: any) => this.mapAnime(item))
      });
    }

    return {
      featured: sections[0]?.items[0],
      sections
    };
  }

  async search(query: string): Promise<AnimeResult[]> {
    const data = await this.fetch('/anime', { q: query, limit: 20 });
    if (!data?.data) return [];
    return data.data.map((item: any) => this.mapAnime(item));
  }

  async getDetails(id: string) {
    const data = await this.fetch(`/anime/${id}/full`);
    if (!data?.data) return null;
    
    const anime = data.data;
    return {
      title: anime.title,
      title_english: anime.title_english,
      title_japanese: anime.title_japanese,
      synopsis: anime.synopsis,
      cover: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url || '',
      score: anime.score?.toString(),
      rating: anime.rating, // ex: "PG-13 - Teens 13 or older"
      duration: anime.duration, // ex: "24 min per ep"
      episodes: anime.episodes, // Contagem de episódios dessa temporada (ex: 28, 10)
      genres: anime.genres?.map((g: any) => g.name) || [],
      year: anime.year?.toString() || anime.aired?.prop?.from?.year?.toString(),
      status: anime.status,
      trailer: anime.trailer?.embed_url,
      relations: anime.relations?.map((rel: any) => ({
        relation: rel.relation,
        entries: rel.entry?.map((entry: any) => ({
          id: entry.mal_id.toString(),
          name: entry.name,
          type: entry.type
        })) || []
      })) || []
    };
  }

  async getEpisodeImages(id: string): Promise<Record<number, string>> {
     const data = await this.fetch(`/anime/${id}/episodes`);
     if (!data?.data) return {};
     
     const thumbMap: Record<number, string> = {};
     data.data.forEach((ep: any) => {
        if (ep.filler || ep.recap) return;
     });
     return thumbMap;
  }

  /**
   * Busca APENAS temporadas reais do anime (Sequels/Prequels do tipo TV ou ONA).
   * Filtra Side Stories, OVAs, Movies, Specials, Music etc.
   * Retorna uma lista limpa estilo Crunchyroll/Netflix.
   */
  async getSeasons(id: string): Promise<any[]> {
    const data = await this.fetch(`/anime/${id}/full`);
    if (!data?.data) return [];

    const anime = data.data;
    const mainSeason = {
      mal_id: anime.mal_id,
      title: anime.title_english || anime.title,
      cover: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url || '',
      year: anime.year?.toString() || anime.aired?.prop?.from?.year?.toString() || '',
      synopsis: anime.synopsis || '',
      episodes_count: anime.episodes || 0,
      score: anime.score?.toString() || '',
      type: anime.type,
      status: anime.status,
      isCurrent: true
    };

    // Filtrar relations: apenas Sequel e Prequel que sejam do tipo Anime (TV ou ONA)
    const validRelations = ['Sequel', 'Prequel'];
    const validTypes = ['TV', 'ONA'];

    const relatedIds: { id: number; relation: string }[] = [];
    
    if (anime.relations) {
      for (const rel of anime.relations) {
        if (!validRelations.includes(rel.relation)) continue;
        for (const entry of rel.entry || []) {
          if (entry.type === 'anime') {
            relatedIds.push({ id: entry.mal_id, relation: rel.relation });
          }
        }
      }
    }

    // Buscar detalhes de cada relation para filtrar apenas TV/ONA
    const seasons: any[] = [mainSeason];
    
    for (const related of relatedIds) {
      try {
        // Rate limit (Jikan: 3 req/s)
        await new Promise(resolve => setTimeout(resolve, 400));
        
        const relData = await this.fetch(`/anime/${related.id}`);
        if (!relData?.data) continue;
        
        const relAnime = relData.data;
        
        // Apenas TV e ONA são temporadas reais
        if (!validTypes.includes(relAnime.type)) {
          console.log(`[Jikan Seasons] Ignorando ${relAnime.title} (tipo: ${relAnime.type})`);
          continue;
        }

        const season = {
          mal_id: relAnime.mal_id,
          title: relAnime.title_english || relAnime.title,
          cover: relAnime.images?.webp?.large_image_url || relAnime.images?.jpg?.large_image_url || '',
          year: relAnime.year?.toString() || relAnime.aired?.prop?.from?.year?.toString() || '',
          synopsis: relAnime.synopsis || '',
          episodes_count: relAnime.episodes || 0,
          score: relAnime.score?.toString() || '',
          type: relAnime.type,
          status: relAnime.status,
          relation: related.relation,
          isCurrent: false
        };

        // Prequel vai antes, Sequel vai depois
        if (related.relation === 'Prequel') {
          seasons.unshift(season);
        } else {
          seasons.push(season);
        }

        // Recursivamente buscar mais temporadas (Sequel do Sequel, Prequel do Prequel)
        // Limitado a 1 nível de profundidade para evitar rate limit
        if (relAnime.relations) {
          for (const subRel of relAnime.relations) {
            if (!validRelations.includes(subRel.relation)) continue;
            for (const subEntry of subRel.entry || []) {
              if (subEntry.type === 'anime' && !seasons.some(s => s.mal_id === subEntry.mal_id)) {
                await new Promise(resolve => setTimeout(resolve, 400));
                const subData = await this.fetch(`/anime/${subEntry.mal_id}`);
                if (subData?.data && validTypes.includes(subData.data.type)) {
                  const subSeason = {
                    mal_id: subData.data.mal_id,
                    title: subData.data.title_english || subData.data.title,
                    cover: subData.data.images?.webp?.large_image_url || subData.data.images?.jpg?.large_image_url || '',
                    year: subData.data.year?.toString() || subData.data.aired?.prop?.from?.year?.toString() || '',
                    synopsis: subData.data.synopsis || '',
                    episodes_count: subData.data.episodes || 0,
                    score: subData.data.score?.toString() || '',
                    type: subData.data.type,
                    status: subData.data.status,
                    relation: subRel.relation,
                    isCurrent: false
                  };
                  
                  if (subRel.relation === 'Prequel') {
                    seasons.unshift(subSeason);
                  } else {
                    seasons.push(subSeason);
                  }
                }
              }
            }
          }
        }
      } catch (e: any) {
        console.error(`[Jikan Seasons] Erro ao buscar temporada ${related.id}: ${e.message}`);
      }
    }

    // Ordenar por ano (mais antigo primeiro)
    seasons.sort((a, b) => {
      const yearA = parseInt(a.year) || 9999;
      const yearB = parseInt(b.year) || 9999;
      return yearA - yearB;
    });

    // Numerar as temporadas
    return seasons.map((s, index) => ({
      ...s,
      seasonNumber: index + 1,
      seasonLabel: `Temporada ${index + 1}`
    }));
  }
}
