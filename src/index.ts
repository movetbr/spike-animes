import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AnimeFireProvider } from './providers/AnimeFireProvider';
import { AnimesOnlineProvider } from './providers/AnimesOnlineProvider';
import { JikanProvider } from './providers/JikanProvider';
import axios from 'axios';

const app = new Hono();
app.use('/*', cors());

// Provedores
const jikan = new JikanProvider(); 
const scraper = new AnimesOnlineProvider();
const fallbackScraper = new AnimeFireProvider();

const videoFallbackProviders = [scraper, fallbackScraper];

app.get('/', (c) => c.json({
  message: 'Spike Animes API 🔥',
  routes: {
    home: '/home',
    search: '/search?q=nome_do_anime',
    details: '/anime/:slug',
    video: '/video/:slug/:episode',
  }
}));

// ===== ROTA: Home (Metadata Jikan) =====
app.get('/home', async (c) => {
  try {
    const homeData = await jikan.getHome();
    return c.json({
      status: 'success',
      provider: 'Jikan',
      data: homeData
    });
  } catch (error: any) {
    return c.json({ error: 'Falha ao carregar a home.', details: error.message }, 500);
  }
});

// ===== ROTA: Busca (Metadata Jikan) =====
app.get('/search', async (c) => {
  const query = c.req.query('q');
  if (!query) return c.json({ error: 'Parâmetro (q) é obrigatório.' }, 400);

  try {
    const results = await jikan.search(query);
    return c.json({ 
      source: 'Jikan', 
      results 
    });
  } catch (error: any) {
    return c.json({ error: `Falha na busca.`, details: error.message }, 500);
  }
});

// ===== ROTA: Detalhes Inteligentes (Ponte Jikan -> Scraper) =====
app.get('/anime/:id', async (c) => {
  const id = c.req.param('id');
  const isNumeric = !isNaN(Number(id));

  try {
    if (isNumeric) {
      // 1. Pegar metadados ricos na Jikan
      const metadata = await jikan.getDetails(id);
      if (!metadata) throw new Error('Anime não encontrado na Jikan.');

      // 2. Tentar achar o anime correspondente no Scraper (Busca Multi-Título)
      // No MAL, 'title_japanese' costuma ser o nome original/romaji que os scrapers usam.
      const searchTerms = [
        metadata.title_japanese, 
        metadata.title_english, 
        metadata.title,
        metadata.title.split(':')[0] // Ex: "Frieren: Beyond..." -> "Frieren"
      ].filter(Boolean) as string[];

      console.log(`[Bridge] Tentando encontrar match para: ${searchTerms.join(' | ')}`);
      
      let match = null;
      for (const term of searchTerms) {
        const results = await scraper.search(term);
        if (results.length > 0) {
          // Tenta achar um que contenha o nome base ou seja o primeiro
          match = results.find(r => 
            r.title.toLowerCase().includes(term.toLowerCase()) || 
            term.toLowerCase().includes(r.title.toLowerCase())
          ) || results[0];
          
          if (match) break;
        }
      }

      if (match) {
        console.log(`[Bridge] Match encontrado no provedor ${scraper.name}: ${match.id}`);
        const scraperDetails = await scraper.getEpisodes(match.id);
        
        return c.json({
          source: 'Hybrid (Jikan + Scraper)',
          ...metadata, // Metadados HD da Jikan (Trailer, Studio, Relations, etc)
          synopsis: scraperDetails.synopsis || metadata.synopsis, // Prioridade Sinopse PT-BR
          episodes: scraperDetails.episodes, // Episódios reais do scraper
          animeSlug: match.id,
          provider: scraper.name
        });
      }

      return c.json({
        source: 'Jikan (No Match)',
        ...metadata,
        episodes: [],
        message: 'Streaming não disponível para este anime ainda no Scraper.'
      });
    } else {
      // Se não for ID numérico, assume que é um slug direto do scraper
      const data = await scraper.getEpisodes(id);
      return c.json({ source: scraper.name, ...data });
    }
  } catch (error: any) {
    return c.json({ error: 'Falha ao processar detalhes.', details: error.message }, 500);
  }
});

// ===== ROTA: Extração de Vídeo com Fallback =====
app.get('/video/:slug/:episode', async (c) => {
  const slug = c.req.param('slug');
  const episode = c.req.param('episode');
  
  // Lógica inteligente de ID:
  // Se o 'slug' já contém a palavra 'episodio', usamos ele direto como o ID do episódio (Padrão AnimesOnlineCC)
  // Caso contrário, montamos slug/episode (Padrão AnimeFire)
  const episodeId = slug.includes('episodio') ? slug : `${slug}/${episode}`;

  const allSources: any[] = [];
  const logs: any[] = [];

  // Busca em todos os provedores em paralelo para maior performance e opções
  const results = await Promise.allSettled(videoFallbackProviders.map(async (p) => {
    try {
      console.log(`[🎯 Multi-Hub] Buscando em ${p.name} para: ${episodeId}...`);
      const sources = await p.extractVideoLinks(episodeId);
      return sources.map(s => ({ ...s, provider: p.name }));
    } catch (error: any) {
      logs.push({ provider: p.name, error: error.message });
      throw error;
    }
  }));

  results.forEach(res => {
    if (res.status === 'fulfilled' && res.value) {
      allSources.push(...res.value);
    }
  });

  if (allSources.length > 0) {
    return c.json({
      status: 'success',
      episode: episode,
      sources: allSources,
      logs
    });
  }

  return c.json({
    status: 'failed',
    message: 'Nenhum vídeo encontrado nos provedores.',
    logs
  }, 404);
});

// ===== ROTA: Detalhes em Batch (Múltiplos IDs) =====
app.post('/anime-details/batch', async (c) => {
  try {
    const { ids } = await c.req.json();
    if (!ids || !Array.isArray(ids)) {
      return c.json({ error: 'Parâmetro (ids) deve ser um array.' }, 400);
    }

    // Processa em paralelo para ser rápido
    const results = await Promise.all(ids.slice(0, 20).map(async (id) => {
      const idStr = String(id);
      const isMalId = idStr.startsWith('jikan-') || !isNaN(Number(idStr));
      const malId = idStr.startsWith('jikan-') ? idStr.replace('jikan-', '') : idStr;

      try {
        // Busca básica no Jikan para ter o título original
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime/${malId}`);
        const anime = jikanRes.data.data;

        // Tenta achar no Scraper
        const searchTerms = [anime.title, anime.title_japanese].filter(Boolean);
        let match = null;
        for (const term of searchTerms) {
          const searchRes = await scraper.search(term);
          if (searchRes.length > 0) {
            match = searchRes[0];
            break;
          }
        }

        return {
          id: match ? match.id : `jikan-${malId}`,
          malId: parseInt(malId),
          title: match ? match.title : anime.title,
          thumbnail: match ? match.cover : (anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url),
          score: anime.score,
          found: !!match
        };
      } catch {
        return { id, error: 'Not found' };
      }
    }));

    return c.json({ status: 'success', data: results });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ===== ROTA: Busca completa estilo API PHP (slug ou link) =====
// Replica exatamente a api.php do MestreTM
app.get('/api', async (c) => {
  const animeSlug = c.req.query('anime_slug');
  const animeLink = c.req.query('anime_link');

  if (!animeSlug && !animeLink) {
    return c.json({ error: 'Parâmetro anime_slug ou anime_link é obrigatório.' }, 400);
  }

  // Validar formato do link se fornecido
  if (animeLink && !animeLink.match(/^https:\/\/animefire\.plus\/animes\/.+/)) {
    return c.json({ error: 'Formato inválido para anime_link. Deve ser "https://animefire.plus/animes/*"' }, 400);
  }

  try {
    // Buscar detalhes do anime
    const details = await scraper.getEpisodes(animeLink || animeSlug!);

    // Para cada episódio, buscar os links de vídeo
    const maxEpisodes = parseInt(c.req.query('max_episodes') || '0');
    let episodes: any[] = [];

    if (maxEpisodes > 0) {
      const slug = details.animeSlug || animeSlug;
      for (let ep = 1; ep <= maxEpisodes; ep++) {
        try {
          const sources = await scraper.extractVideoLinks(`${slug}/${ep}`);
          episodes.push({
            episode: ep,
            data: sources.map(s => ({
              url: s.url,
              resolution: s.quality,
              status: (s as any).status || 'ONLINE'
            }))
          });
        } catch {
          break;
        }
      }
    }

    return c.json({
      anime_slug: (details as any).animeSlug || animeSlug,
      anime_title: details.title,
      anime_image: details.cover,
      anime_synopsis: details.synopsis,
      anime_score: details.score || '0.0',
      anime_info: details.genres || [],
      episodes: maxEpisodes > 0 ? episodes : details.episodes,
      response: { status: '200', text: 'OK' }
    });
  } catch (error: any) {
    return c.json({
      error: error.message,
      response: { status: '500', text: 'Internal Server Error' }
    }, 500);
  }
});

const port = parseInt(process.env.PORT || '3000');
console.log(`\n🔥 Kaizen API (AnFireAPI TypeScript Edition)`);
console.log(`➡️  Provedores: ${videoFallbackProviders.map(p => p.name).join(', ')}`);

serve({ fetch: app.fetch, port });
