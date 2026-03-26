import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeProvider, VideoSource, AnimeResult, EpisodeResult } from './BaseProvider';

export class AnimesOnlineProvider implements AnimeProvider {
  name = 'AnimesOnlineCC';
  baseUrl = 'https://animesonlinecc.to';

  private headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  async search(query: string): Promise<AnimeResult[]> {
    try {
      // URL de busca do WordPress/DooPlay
      const url = `${this.baseUrl}/?s=${encodeURIComponent(query)}`;
      console.log(`[AnimesOnlineCC] Pesquisando em: ${url}`);
      
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results: AnimeResult[] = [];

      // Seletor padrão do DooPlay para resultados de busca
      $(".result-item").each((_, el) => {
        const title = $(el).find('.title a').text().trim();
        const link = $(el).find('.title a').attr('href');
        const img = $(el).find('.thumbnail img').attr('src');

        if (title && link) {
          const id = link.split('/').filter(Boolean).pop()!;
          results.push({
            title,
            url: link,
            cover: img || '',
            id
          });
        }
      });

      return results;
    } catch (error: any) {
      console.error(`[AnimesOnlineCC Search Error] ${error.message}`);
      return [];
    }
  }

  async getEpisodes(id: string) {
    try {
      const url = id.startsWith('http') ? id : `${this.baseUrl}/anime/${id}`;
      console.log(`[AnimesOnlineCC] Detalhes em: ${url}`);
      
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);

      const title = $('.data h1').text().trim() || id;
      const synopsis = $('.resume p').text().trim();
      const cover = $('.poster img').attr('src') || '';
      
      const episodes: EpisodeResult[] = [];
      
      // No DooPlay, episódios ficam em abas de temporadas ou lista linear
      $(".episodio").each((_, el) => {
        const epLink = $(el).find('a').attr('href');
        const epTitle = $(el).find('.episodiotitle a').text().trim();
        
        if (epLink) {
          // Extrair o slug/ep da URL (ex: /episodio/solo-leveling-1x1/ -> solo-leveling-1x1)
          const epId = epLink.split('/').filter(Boolean).pop()!;
          episodes.push({
            title: epTitle || `Episódio ${episodes.length + 1}`,
            url: epLink,
            id: epId
          });
        }
      });

      return {
        title,
        synopsis,
        cover,
        episodes: episodes.reverse(), // Geralmente vêm do mais novo pro mais antigo
        animeSlug: id
      };
    } catch (error: any) {
      console.error(`[AnimesOnlineCC Details Error] ${error.message}`);
      throw error;
    }
  }

  async extractVideoLinks(episodeId: string): Promise<VideoSource[]> {
    // Para o AnimesOnlineCC, o episodeId pode ser o slug direto do episódio
    // Ex: "solo-leveling-1x1"
    const url = episodeId.startsWith('http') 
        ? episodeId 
        : `${this.baseUrl}/episodio/${episodeId}`;
        
    console.log(`[AnimesOnlineCC] Extraindo vídeo de: ${url}...`);

    try {
      const response = await axios.get(url, { headers: this.headers });
      const html = response.data;
      const $ = cheerio.load(html);

      // No DooPlay, o vídeo costuma estar em iframes dentro de players
      // ou direto na página se for embed direto.
      const iframes: string[] = [];
      
      // Tentar pegar do player principal
      $('iframe').each((_, el) => {
        const src = $(el).attr('src');
        if (src && !src.includes('google') && !src.includes('facebook')) {
            iframes.push(src);
        }
      });

      if (iframes.length > 0) {
        return iframes.map(src => ({
          quality: 'Embed',
          url: src,
          type: 'embed'
        }));
      }

      // Fallback: regex se o Cheerio falhar
      const regex = /<iframe[^>]*src="([^"]+)"[^>]*><\/iframe>/is;
      const match = html.match(regex);

      if (match && match[1]) {
        return [
          {
            quality: 'Embed',
            url: match[1],
            type: 'embed'
          }
        ];
      }

      throw new Error("Iframe de vídeo não encontrado.");
    } catch (error: any) {
      throw new Error(`Erro no AnimesOnlineCC: ${error.message}`);
    }
  }
}
