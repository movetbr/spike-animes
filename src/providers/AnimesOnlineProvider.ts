import axios from 'axios';
import * as cheerio from 'cheerio';
import { AnimeProvider, VideoSource, AnimeResult, EpisodeResult, HomeData, HomeSection } from './BaseProvider';

export class AnimesOnlineProvider implements AnimeProvider {
  name = 'AnimesOnlineCC';
  baseUrl = 'https://animesonlinecc.to';

  private headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://animesonlinecc.to/'
  };

  async search(query: string): Promise<AnimeResult[]> {
    try {
      const url = query 
        ? `${this.baseUrl}/?s=${encodeURIComponent(query)}`
        : `${this.baseUrl}/anime/`;
      
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results: AnimeResult[] = [];

      $(".result-item, .item").each((_, el) => {
        const title = $(el).find('.title a, h3 a').text().trim();
        const link = $(el).find('.title a, h3 a').attr('href');
        const img = $(el).find('.thumbnail img, .poster img').attr('src');
        const score = $(el).find('.rating').text().trim();

        if (title && link) {
          const id = link.split('/').filter(Boolean).pop()!;
          results.push({
            id,
            title,
            cover: img || '',
            url: link,
            score: score || '0.0',
            provider: this.name
          });
        }
      });

      return results;
    } catch (error: any) {
      console.error(`[AnimesOnlineCC Search Error] ${error.message}`);
      return [];
    }
  }

  async getHome(): Promise<HomeData> {
    try {
      const { data } = await axios.get(this.baseUrl, { headers: this.headers });
      const $ = cheerio.load(data);
      const sections: HomeSection[] = [];

      // HELPER: Normaliza URL da imagem
      const normalizeImg = (img?: string) => {
        if (!img) return '';
        if (img.startsWith('//')) return `https:${img}`;
        if (img.startsWith('/')) return `${this.baseUrl}${img}`;
        if (img.startsWith('wp-content')) return `${this.baseUrl}/${img}`;
        return img;
      };

      // HELPER: Função interna para extrair itens de uma seção (DooPlay style)
      const extractSection = (container: any): AnimeResult[] => {
        const items: AnimeResult[] = [];
        $(container).find('.item').each((_, el) => {
          const title = $(el).find('h3 a, .title a').text().trim() || $(el).find('.serie').text().trim();
          const link = $(el).find('h3 a, .title a, a').attr('href');
          const img = $(el).find('.poster img, img').attr('src') || $(el).find('.poster img, img').attr('data-src');
          const score = $(el).find('.rating').text().trim();
          const ep = $(el).find('.episodio').text().trim();

          if (title && link) {
            items.push({
              id: link.split('/').filter(Boolean).pop()!,
              title: ep ? `${title} - ${ep}` : title,
              cover: normalizeImg(img),
              url: link,
              score: score || '0.0',
              provider: this.name
            });
          }
        });
        return items;
      };

      // No DooPlay, as seções da Home costumam estar em blocos .listUpd ou identificadas por IDs
      
      // 1. Animes Online (Destaques do Topo)
      // Baseado no screenshot: É a primeira seção com posters verticais
      const animesOnline = extractSection($(".listUpd").first());
      if (animesOnline.length > 0) {
        sections.push({ title: 'Animes Online', items: animesOnline });
      }

      // 2. Últimos Episódios
      // Baseado no screenshot: Segunda seção com thumbs horizontais
      const latestEpisodes = extractSection($(".listUpd").eq(1));
      if (latestEpisodes.length > 0) {
        sections.push({ title: 'Últimos Episódios', items: latestEpisodes });
      }

      // 3. Animes Recentes
      // Baseado no screenshot: Terceira seção com posters verticais
      const recentAnimes = extractSection($(".listUpd").eq(2));
      if (recentAnimes.length > 0) {
        sections.push({ title: 'Animes Recentes', items: recentAnimes });
      }

      // 4. Filmes (Se existir mais abaixo)
      const movies = extractSection($("#muvies-2"));
      if (movies.length > 0) {
        sections.push({ title: 'Filmes de Anime', items: movies });
      }

      // 5. Populares (Sidebar)
      const popular: AnimeResult[] = [];
      $(".w_item_b").each((_, el) => {
        const title = $(el).find('h3').text().trim();
        const link = $(el).find('a').attr('href');
        const img = $(el).find('img').attr('src');
        const score = $(el).find('b').text().trim();
        if (title && link) {
          popular.push({
            id: link.split('/').filter(Boolean).pop()!,
            title,
            cover: normalizeImg(img),
            url: link,
            score: score || '0.0',
            provider: this.name
          });
        }
      });
      if (popular.length > 0) {
        sections.push({ title: 'Mais Populares (Ranking)', items: popular });
      }

      return {
        featured: animesOnline[0] || recentAnimes[0],
        sections
      };
    } catch (error: any) {
      console.error(`[AnimesOnlineCC Home Error] ${error.message}`);
      return { sections: [] };
    }
  }

  async getEpisodes(id: string) {
    try {
      const url = id.startsWith('http') ? id : `${this.baseUrl}/anime/${id}`;
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);

      const title = $('.data h1').text().trim() || id;
      const synopsis = $('#p-resume p, .resume p, div[itemprop="description"] p, .wp-content p').first().text().trim();
      const cover = $('.poster img').attr('src') || '';
      const score = $('.dt_rating_vgs').text().trim();
      const year = $('.date').text().trim();
      const status = $('.extra span:last-child').text().trim();
      
      const genres: string[] = [];
      $('.sgeneros a').each((_, el) => {
        genres.push($(el).text().trim());
      });

      const episodes: EpisodeResult[] = [];
      // Seletor robusto para DooPlay (episódios simples ou em abas de temporadas)
      $(".episodios li, .episodio, .se-a li").each((_, el) => {
        const epLink = $(el).find('a').attr('href');
        const epTitle = $(el).find('.episodiotitle a, .eptitle a').text().trim() || $(el).find('a').text().trim();
        if (epLink) {
          const epId = epLink.split('/').filter(Boolean).pop()!;
          const numMatch = epTitle.match(/\d+/);
          const epNumber = numMatch ? parseInt(numMatch[0]) : 0;

          episodes.push({
            id: epId,
            title: epTitle || `${title} - Ep`,
            url: epLink,
            number: epNumber
          });
        }
      });

      return {
        title,
        synopsis,
        cover,
        score,
        genres,
        year,
        status,
        episodes: episodes.reverse(),
        animeSlug: id
      };
    } catch (error: any) {
      console.error(`[AnimesOnlineCC Details Error] ${error.message}`);
      throw error;
    }
  }

  async extractVideoLinks(episodeId: string): Promise<VideoSource[]> {
    const url = episodeId.startsWith('http') ? episodeId : `${this.baseUrl}/episodio/${episodeId}`;
    console.log(`[AnimesOnlineCC] Analisando episódio para AJAX: ${url}`);

    try {
      const { data: html } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(html);

      const postId = $('input[name="post_id"]').val() || html.match(/var\s+player_data\s*=\s*{\s*"post_id":"(\d+)"/)?.[1];
      
      if (!postId) {
        const staticIframe = $('iframe').attr('src');
        if (staticIframe) return [{ quality: 'Embed', url: staticIframe, type: 'embed' }];
        throw new Error("ID do post não encontrado para carregar o player.");
      }

      const sources: VideoSource[] = [];
      
      for (let i = 1; i <= 2; i++) {
        try {
          const ajaxUrl = `${this.baseUrl}/wp-admin/admin-ajax.php`;
          const params = new URLSearchParams();
          params.append('action', 'doo_player_ajax');
          params.append('post', postId.toString());
          params.append('nume', i.toString());
          params.append('type', 'tv');

          const { data: ajaxRes } = await axios.post(ajaxUrl, params.toString(), {
            headers: {
              ...this.headers,
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest'
            }
          });

          if (ajaxRes?.embed_url) {
            sources.push({
              quality: i === 1 ? 'Principal' : 'Backup',
              url: ajaxRes.embed_url,
              type: 'embed'
            });
          }
        } catch (e) {
          // Ignora erros de player inexistente
        }
      }

      if (sources.length === 0) throw new Error("Nenhum player retornado pelo AJAX.");
      return sources;
    } catch (error: any) {
      throw new Error(`Erro no AnimesOnlineCC: ${error.message}`);
    }
  }
}
