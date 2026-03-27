import { AnimeProvider, AnimeResult, EpisodeResult, VideoSource, HomeData, HomeSection } from './BaseProvider';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * AnimeFireProvider — Tradução fiel da API PHP do MestreTM/AnFireAPI para TypeScript.
 * 
 * Descoberta-chave: O AnimeFire possui uma API JSON interna em:
 *   https://animefire.plus/video/{slug}/{episode}
 * 
 * Essa rota retorna { data: [{ src, label }], response: { status } }
 * SEM precisar de Puppeteer! O PHP original faz exatamente isso.
 * 
 * Quando o campo `src` contém "googlevideo.com" (links temporários do Google),
 * o PHP busca um iframe do Blogger na página do episódio como fallback.
 */
export class AnimeFireProvider extends AnimeProvider {
  name = 'AnimeFire';
  baseUrl = 'https://animefire.io';

  private headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  // ===== BUSCA (index.php → extractSearchResults) =====
  async search(query: string): Promise<AnimeResult[]> {
    try {
      const url = query 
        ? `${this.baseUrl}/pesquisar/${encodeURIComponent(query)}`
        : `${this.baseUrl}/animes-atualizados/1`;
        
      console.log(`[AnimeFire] Pesquisando em: ${url}`);
      const { data } = await axios.get(url, { headers: this.headers });
      const $ = cheerio.load(data);
      const results: AnimeResult[] = [];

      // Seletores de cards: divCardUltimosEps (Home/Latest) ou col-6 (Search)
      $("div.divCardUltimosEps, div.col-6, div.divCardHome").each((_, el) => {
        const link = $(el).find('a').attr('href');
        const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
        const title = $(el).find('h3.animeTitle').text().trim() || $(el).find('h4').text().trim();

        if (title && link) {
          const id = link.split('/').pop()!;
          if (!results.some(r => r.id === id)) {
            results.push({
              id,
              title,
              cover: img || '',
              url: link,
              provider: this.name
            });
          }
        }
      });

      return results;
    } catch (error: any) {
      console.error(`[Search Error] ${error.message}`);
      return []; 
    }
  }

  // ===== DETALHES + EPISÓDIOS (api.php → fetchAnime* + testEpisodes) =====
  async getEpisodes(animeSlugOrLink: string) {
    // Aceita tanto um slug quanto um link completo
    const animePageUrl = animeSlugOrLink.startsWith('http')
      ? animeSlugOrLink
      : `${this.baseUrl}/animes/${animeSlugOrLink}`;

    const { data: html } = await axios.get(animePageUrl, { headers: this.headers });
    const $ = cheerio.load(html);

    // Extraindo metadados (mesmos seletores do PHP original)
    const title = $('h1.quicksand400').text().trim() || $('div.animeInfoName h1').text().trim() || animeSlugOrLink;
    const cover = $("div.sub_animepage_img img").attr('data-src') || $("div.sub_animepage_img img").attr('src') || '';
    const synopsis = $("div.divSinopse span.spanAnimeInfo").text().trim();
    const score = $('h4#anime_score').text().trim();
    const votes = $('h6#anime_votos').text().trim();

    // Extraindo info/gêneros
    const infoTags: string[] = [];
    $("div.animeInfo a").each((_, el) => {
      infoTags.push($(el).text().trim());
    });

    // Extraindo lista de episódios
    const episodes: EpisodeResult[] = [];
    $("div.div_video_list a, a.lEp.epT").each((_, el) => {
      const href = $(el).attr('href');
      const epTitle = $(el).find('.numEp').text().trim() || $(el).text().trim() || `Episódio ${episodes.length + 1}`;
      if (href) {
        const numMatch = epTitle.match(/\d+/);
        const epNumber = numMatch ? parseInt(numMatch[0]) : episodes.length + 1;

        episodes.push({
          id: href.split('/').slice(-2).join('/'),
          title: epTitle,
          url: href,
          number: epNumber
        });
      }
    });

    return {
      title,
      synopsis,
      cover,
      score,
      votes,
      genres: infoTags,
      animeSlug: animeSlugOrLink.split('/').pop()!,
      episodes
    };
  }

  // ===== EXTRAÇÃO DE VÍDEO (api.php → testEpisodes + fetchBloggerIframeUrl) =====
  async extractVideoLinks(episodeId: string): Promise<VideoSource[]> {
    // episodeId = "slug/numero" (ex: "naruto-shippuden-todos-os-episodios/1")
    const videoApiUrl = `${this.baseUrl}/video/${episodeId}`;
    console.log(`[AnimeFire] Chamando API JSON interna: ${videoApiUrl}`);

    const { data: json } = await axios.get(videoApiUrl, { headers: this.headers });

    // Verificar se a API retornou erro 500 interno
    if (json?.response?.status === '500' || json?.response?.status === 500) {
      throw new Error('AnimeFire API interna retornou status 500 para este episódio.');
    }

    if (!json?.data || json.data.length === 0) {
      throw new Error('AnimeFire API interna não retornou nenhum dado de vídeo.');
    }

    // Verificar se algum link é do Google Video (temporário/expirado)
    const hasGoogleVideo = json.data.some((item: any) =>
      item.src && item.src.includes('googlevideo.com')
    );

    // Se tem googlevideo, buscar iframe do Blogger como fallback (lógica do PHP)
    let bloggerUrl: string | null = null;
    if (hasGoogleVideo) {
      console.log('[AnimeFire] Links do Google Video detectados. Buscando iframe do Blogger...');
      const parts = episodeId.split('/');
      const slug = parts[0];
      const epNum = parts[1];
      const episodePageUrl = `${this.baseUrl}/animes/${slug}/${epNum}`;
      bloggerUrl = await this.fetchBloggerIframeUrl(episodePageUrl);
      if (bloggerUrl) {
        console.log(`[AnimeFire] Blogger iframe encontrado: ${bloggerUrl}`);
      }
    }

    // Formatar os resultados (mesma lógica do PHP)
    const sources: VideoSource[] = json.data.map((item: any) => {
      const rawUrl: string = item.src || '';
      const resolution: string = item.label || 'unknown';

      if (rawUrl.includes('googlevideo.com')) {
        // Se tem blogger, usa como alternativa; senão marca como OFFLINE
        return {
          quality: resolution,
          url: bloggerUrl || rawUrl,
          status: bloggerUrl ? 'ONLINE' : 'OFFLINE',
          type: bloggerUrl ? 'blogger_embed' : 'googlevideo_expired'
        };
      }

      return {
        quality: resolution,
        url: this.formatUrl(rawUrl),
        status: 'ONLINE',
        type: 'direct',
        headers: {
          'Referer': 'https://animefire.io/'
        }
      };
    });

    // Filtrar apenas os que estão ONLINE
    const onlineSources = sources.filter((s: any) => s.status !== 'OFFLINE');
    if (onlineSources.length === 0 && sources.length > 0) {
      // Se todos estão offline, retorna os googlevideo mesmo assim
      return sources;
    }

    return onlineSources.length > 0 ? onlineSources : sources;
  }

  // ===== HOME (Página Inicial) =====
  async getHome(): Promise<HomeData> {
    try {
      const { data } = await axios.get(this.baseUrl, { headers: this.headers });
      const $ = cheerio.load(data);
      const sections: HomeSection[] = [];

      // Seção 1: Últimos Episódios
      const latestEpisodes: AnimeResult[] = [];
      $("div.divCardUltimosEps").each((_, el) => {
        const link = $(el).find('a').attr('href');
        const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
        const title = $(el).find('h3.animeTitle').text().trim();
        const epNum = $(el).find('span.numEp').text().trim();

        if (title && link) {
          latestEpisodes.push({
            id: link.split('/').pop()!,
            title: `${title} - ${epNum}`,
            cover: img || '',
            url: link,
            provider: this.name
          });
        }
      });

      if (latestEpisodes.length > 0) {
        sections.push({ title: 'Últimos Episódios', items: latestEpisodes });
      }

      // Seção 2: Animes Recentes/Destaques
      const featuredAnimes: AnimeResult[] = [];
      $("div.divCardHome").each((_, el) => {
        const link = $(el).find('a').attr('href');
        const img = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
        const title = $(el).find('h4').text().trim();

        if (title && link) {
          featuredAnimes.push({
            id: link.split('/').pop()!,
            title,
            cover: img || '',
            url: link,
            provider: this.name
          });
        }
      });

      if (featuredAnimes.length > 0) {
        sections.push({ title: 'Animes em Destaque', items: featuredAnimes });
      }

      return {
        featured: featuredAnimes[0],
        sections
      };
    } catch (error: any) {
      console.error(`[AnimeFire Home Error] ${error.message}`);
      return { sections: [] };
    }
  }

  // ===== Busca o iframe do Blogger na página do episódio (PHP: fetchBloggerIframeUrl) =====
  private async fetchBloggerIframeUrl(episodePageUrl: string): Promise<string | null> {
    try {
      const { data: html } = await axios.get(episodePageUrl, { headers: this.headers });
      const $ = cheerio.load(html);
      const iframeSrc = $("iframe[src*='blogger.com']").attr('src');
      return iframeSrc || null;
    } catch {
      return null;
    }
  }

  private formatUrl(url: string): string {
    return url.replace(/\\\//g, '/').replace(/\\\\/g, '/');
  }
}
