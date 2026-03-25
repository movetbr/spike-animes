import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AnimeFireProvider } from './providers/AnimeFireProvider';
import { AnimesOnlineProvider } from './providers/AnimesOnlineProvider';
import axios from 'axios';

const app = new Hono();
app.use('/*', cors());

// Provedor principal: AnimeFire (tradução fiel da API PHP do MestreTM)
const provider = new AnimeFireProvider();

// Provedores de fallback para extração de vídeo
const videoFallbackProviders = [
  provider,
  new AnimesOnlineProvider()
];

app.get('/', (c) => c.json({
  message: 'Kaizen API 🔥 (Tradução da AnFireAPI PHP → TypeScript)',
  routes: {
    search: '/search?q=nome_do_anime',
    details: '/anime/:slug',
    video: '/video/:slug/:episode',
    latest: '/latest'
  }
}));

// ===== ROTA: Busca =====
app.get('/search', async (c) => {
  const query = c.req.query('q');
  if (!query) return c.json({ error: 'Parâmetro (q) é obrigatório.' }, 400);

  try {
    const results = await provider.search(query);
    return c.json({ source: provider.name, results });
  } catch (error: any) {
    return c.json({ error: `Falha na busca.`, details: error.message }, 500);
  }
});

// ===== ROTA: Últimos Animes Atualizados (index.php → animes-atualizados) =====
app.get('/latest', async (c) => {
  try {
    const results = await provider.search(''); // A busca vazia pega os últimos
    return c.json({ source: provider.name, results });
  } catch (error: any) {
    return c.json({ error: 'Falha ao pegar últimos animes.', details: error.message }, 500);
  }
});

// ===== ROTA: Detalhes + Episódios do Anime =====
// Aceita tanto slug quanto link completo via query param
app.get('/anime/:slug', async (c) => {
  const slug = c.req.param('slug');
  const link = c.req.query('link'); // Opcional: ?link=https://animefire.plus/animes/...

  try {
    const data = await provider.getEpisodes(link || slug);
    return c.json({ source: provider.name, ...data });
  } catch (error: any) {
    return c.json({ error: 'Falha ao extrair detalhes do anime.', details: error.message }, 500);
  }
});

// ===== ROTA: Extração de Vídeo com Fallback =====
// Formato: /video/slug/episodio (ex: /video/naruto-shippuden-todos-os-episodios/1)
app.get('/video/:slug/:episode', async (c) => {
  const slug = c.req.param('slug');
  const episode = c.req.param('episode');
  const episodeId = `${slug}/${episode}`;

  const errorLogs: { provider: string; error: string }[] = [];

  for (const p of videoFallbackProviders) {
    try {
      console.log(`[🎯 Fallback] Tentando: ${p.name}...`);
      const sources = await p.extractVideoLinks(episodeId);

      if (sources && sources.length > 0) {
        console.log(`[✅ SUCESSO] ${p.name} retornou ${sources.length} link(s) de vídeo!`);
        return c.json({
          status: 'success',
          provider: p.name,
          episode: parseInt(episode),
          sources
        });
      }
    } catch (error: any) {
      console.log(`[❌ Erro] ${p.name}: ${error.message}`);
      errorLogs.push({ provider: p.name, error: error.message });
    }
  }

  return c.json({
    status: 'failed',
    message: 'Nenhum provedor conseguiu extrair o vídeo deste episódio.',
    logs: errorLogs
  }, 500);
});

// ===== ROTA: Detalhes Unificados (Bridge Jikan + AnimeFire) =====
app.get('/anime-details/:id', async (c) => {
  const id = c.req.param('id');
  const idStr = String(id);
  const isMalId = idStr.startsWith('jikan-') || !isNaN(Number(idStr));
  const malId = idStr.startsWith('jikan-') ? idStr.replace('jikan-', '') : idStr;

  try {
    let baseData: any = null;

    if (isMalId) {
      console.log(`[Bridge] Requisitando Jikan para MAL ID: ${malId}`);
      try {
        const jikanRes = await axios.get(`https://api.jikan.moe/v4/anime/${malId}/full`);
        const anime = jikanRes.data.data;

        baseData = {
          id: `jikan-${malId}`,
          malId: parseInt(malId),
          title: anime.title,
          englishName: anime.title_english || null,
          originalTitle: anime.title_japanese || anime.title, // Romaji/Japanese
          description: anime.synopsis,
          thumbnail: anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url,
          genres: anime.genres?.map((g: any) => g.name) || [],
          status: anime.status,
          type: anime.type,
          score: anime.score,
          rating: anime.rating,
          episodes: null
        };

        // Smart Linking: Busca no AnimeFire usando os títulos do Jikan
        const searchTerms = [anime.title, anime.title_japanese, anime.title_english].filter(Boolean);
        console.log(`[Bridge] Smart Linking: Testando termos: ${searchTerms.join(', ')}`);

        let localMatch = null;
        for (const term of searchTerms) {
          const results = await provider.search(term);
          if (results.length > 0) {
            // Fuzzy match simples: verifica se o título do resultado contém parte do termo
            localMatch = results.find(r =>
              r.title.toLowerCase().includes(anime.title.toLowerCase().split(' ')[0])
            ) || results[0];
            break;
          }
        }

        if (localMatch) {
          console.log(`[Bridge] Match encontrado: ${localMatch.title} (${localMatch.id})`);
          const episodesData = await provider.getEpisodes(localMatch.id);
          
          // Prioridade para dados do AnimeFire (PT-BR) conforme pedido do usuário
          baseData.title = localMatch.title;
          baseData.thumbnail = localMatch.cover || baseData.thumbnail;
          baseData.description = episodesData.synopsis || baseData.description;
          baseData.episodes = episodesData.episodes;
          baseData.id = localMatch.id; // Atualiza ID para o slug do AnimeFire
        }
      } catch (jikanError: any) {
        console.error(`[Bridge] Erro ao consultar Jikan: ${jikanError.message}`);
      }
    }

    // Se não for MAL ID ou Jikan falhou, tenta buscar direto no AnimeFire pelo ID (slug)
    if (!baseData || !baseData.episodes) {
      console.log(`[Bridge] Buscando diretamente no AnimeFire pelo slug: ${id}`);
      try {
        const directData = await provider.getEpisodes(id);
        if (!baseData) {
          baseData = {
            id: directData.animeSlug || id,
            title: directData.title,
            description: directData.synopsis,
            thumbnail: directData.cover,
            genres: directData.genres ? directData.genres.split(', ') : [],
            score: parseFloat(directData.score) || null,
            episodes: directData.episodes
          };
        } else {
          baseData.episodes = directData.episodes;
        }
      } catch (directError: any) {
        if (!baseData) throw directError;
      }
    }

    return c.json({
      status: 'success',
      source: 'Kaizen-Bridge',
      data: baseData
    });

  } catch (error: any) {
    console.error(`[Bridge Error] ${error.message}`);
    return c.json({
      status: 'error',
      message: error.message,
      response: { status: '500', text: 'Internal Server Error' }
    }, 500);
  }
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
        
        // Tenta achar no AnimeFire
        const searchTerms = [anime.title, anime.title_japanese].filter(Boolean);
        let match = null;
        for (const term of searchTerms) {
          const searchRes = await provider.search(term);
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
    const details = await provider.getEpisodes(animeLink || animeSlug!);

    // Para cada episódio, buscar os links de vídeo
    // (AVISO: isso pode demorar bastante para animes com muitos episódios!)
    const maxEpisodes = parseInt(c.req.query('max_episodes') || '0');
    let episodes: any[] = [];

    if (maxEpisodes > 0) {
      // Modo batch: busca vídeos dos primeiros N episódios
      const slug = details.animeSlug || animeSlug;
      for (let ep = 1; ep <= maxEpisodes; ep++) {
        try {
          const sources = await provider.extractVideoLinks(`${slug}/${ep}`);
          episodes.push({
            episode: ep,
            data: sources.map(s => ({
              url: s.url,
              resolution: s.quality,
              status: (s as any).status || 'ONLINE'
            }))
          });
        } catch {
          // Se der erro, significa que não tem mais episódios
          break;
        }
      }
    }

    return c.json({
      anime_slug: details.animeSlug || animeSlug,
      anime_title: details.title,
      anime_image: details.cover,
      anime_synopsis: details.synopsis,
      anime_score: details.score,
      anime_votes: details.votes,
      youtube_trailer: details.trailer,
      anime_info: details.genres,
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
