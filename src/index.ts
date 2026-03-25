import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AnimeFireProvider } from './providers/AnimeFireProvider';
import { AnimesOnlineProvider } from './providers/AnimesOnlineProvider';

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
console.log(`🚀 Servidor rodando em http://localhost:${port}\n`);

serve({ fetch: app.fetch, port });
