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
      title_japanese: anime.title_japanese, // Nota: No MAL isto costuma ser o nome original/romaji
      synopsis: anime.synopsis,
      cover: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url || '',
      score: anime.score?.toString(),
      genres: anime.genres?.map((g: any) => g.name) || [],
      year: anime.year?.toString(),
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
}
