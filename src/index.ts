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

// ===== ROTA: Temporadas Reais (Filtro Inteligente) =====
app.get('/anime/:id/seasons', async (c) => {
  const id = c.req.param('id');
  
  try {
    console.log(`[Seasons] Buscando temporadas para: ${id}`);
    const seasons = await jikan.getSeasons(id);
    
    return c.json({
      status: 'success',
      anime_id: id,
      total: seasons.length,
      seasons
    });
  } catch (error: any) {
    return c.json({ error: 'Falha ao buscar temporadas.', details: error.message }, 500);
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

      // 2. Limpar títulos para busca nos scrapers (somente como FALLBACK)
      const cleanSeasonFromTitle = (title: string) =>
        title
          .replace(/\s*(2nd|3rd|4th|5th|\d+th)\s+Season/gi, '')
          .replace(/\s*Season\s*\d+/gi, '')
          .replace(/\s*Part\s*\d+/gi, '')
          .replace(/\s*Cour\s*\d+/gi, '')
          .replace(/\s*\d+ª?\s*Temporada/gi, '')
          .trim();

      const rawTitle = metadata.title || '';
      const rawEnglish = metadata.title_english || '';
      const cleanedTitle = cleanSeasonFromTitle(rawTitle);
      const cleanedEnglish = cleanSeasonFromTitle(rawEnglish);

      // TÍTULO ORIGINAL PRIMEIRO! Depois versões limpas como fallback.
      // Isso garante que "Sousou no Frieren 2nd Season" ache a 2ª temporada,
      // e "Sousou no Frieren" ache a 1ª.
      const searchTerms = [
        rawTitle,                                                 // "Sousou no Frieren 2nd Season" ← EXATO
        rawEnglish,                                               // "Frieren: Beyond Journey's End Season 2"
        cleanedTitle !== rawTitle ? cleanedTitle : null,          // "Sousou no Frieren" (fallback)
        cleanedEnglish !== rawEnglish ? cleanedEnglish : null,    // "Frieren: Beyond..."
        rawEnglish?.split(':')[0]?.trim(),                        // "Frieren"
        rawTitle?.split(':')[0]?.trim(),                          // "Sousou no Frieren"
        metadata.title_japanese,                                  // Japonês (último recurso)
      ].filter(Boolean) as string[];

      // Remover duplicatas mantendo a ordem
      const uniqueTerms = [...new Set(searchTerms)];

      console.log(`[Bridge] Termos de busca: ${uniqueTerms.join(' | ')}`);

      // 3. Buscar em TODOS os provedores (AnimesOnlineCC + AnimeFire)
      let match: any = null;
      let matchedProvider: any = null;
      const originalTitleLower = rawTitle.toLowerCase();

      for (const term of uniqueTerms) {
        for (const provider of videoFallbackProviders) {
          try {
            const results = await provider.search(term);
            if (results.length > 0) {
              // Matching inteligente: comparar com o título ORIGINAL (não o termo de busca)
              // 1. Match exato
              const exactMatch = results.find(r =>
                r.title.toLowerCase().trim() === originalTitleLower.trim()
              );
              // 2. Match parcial (título do resultado contém o original ou vice-versa)
              const partialMatch = results.find(r => {
                const rTitle = r.title.toLowerCase().split('(')[0].trim();
                return rTitle.includes(originalTitleLower) ||
                       originalTitleLower.includes(rTitle);
              });
              // 3. Match pelo termo de busca atual
              const termLower = term.toLowerCase();
              const termMatch = results.find(r =>
                r.title.toLowerCase().includes(termLower) ||
                termLower.includes(r.title.toLowerCase().split('(')[0].trim())
              );

              match = exactMatch || partialMatch || termMatch || results[0];

              if (match) {
                matchedProvider = provider;
                console.log(`[Bridge] ✅ Match em ${provider.name}: "${match.title}" (${match.id}) [${exactMatch ? 'exato' : partialMatch ? 'parcial' : termMatch ? 'termo' : 'fallback'}]`);
                break;
              }
            }
          } catch (e: any) {
            console.log(`[Bridge] ❌ Falha em ${provider.name} para "${term}": ${e.message}`);
          }
        }
        if (match) break;
      }

      // 4. Construir lista de temporadas a partir das relations da Jikan
      const seasons: any[] = [{
        mal_id: parseInt(id),
        title: metadata.title_english || metadata.title,
        cover: metadata.cover,
        isCurrent: true
      }];

      if (metadata.relations) {
        for (const rel of metadata.relations) {
          if (!['Sequel', 'Prequel'].includes(rel.relation)) continue;
          for (const entry of rel.entries) {
            if (entry.type === 'anime') {
              const season: any = {
                mal_id: parseInt(entry.id),
                title: entry.name,
                relation: rel.relation,
                isCurrent: false
              };
              if (rel.relation === 'Prequel') {
                seasons.unshift(season);
              } else {
                seasons.push(season);
              }
            }
          }
        }
      }

      // 4.1 Buscar covers das temporadas que não têm (via Jikan)
      for (const season of seasons) {
        if (season.cover) continue;
        try {
          await new Promise(r => setTimeout(r, 350)); // Rate limit Jikan
          const res = await axios.get(`https://api.jikan.moe/v4/anime/${season.mal_id}`);
          const data = res.data?.data;
          if (data) {
            season.cover = data.images?.webp?.large_image_url || data.images?.jpg?.large_image_url || '';
            season.episodes_count = data.episodes || 0;
            season.year = data.year?.toString() || data.aired?.prop?.from?.year?.toString() || '';
            season.score = data.score?.toString() || '';
          }
        } catch (e: any) {
          console.log(`[Seasons] Erro ao buscar cover para ${season.mal_id}: ${e.message}`);
        }
      }

      // Numerar temporadas
      const numberedSeasons = seasons.map((s, i) => ({
        ...s,
        seasonNumber: i + 1,
        seasonLabel: `Temporada ${i + 1}`
      }));

      // 5. Montar resposta
      if (match && matchedProvider) {
        const scraperDetails = await matchedProvider.getEpisodes(match.id);
        let finalEpisodes = scraperDetails.episodes || [];
        
        console.log(`[Bridge] ${finalEpisodes.length} episódios brutos via ${matchedProvider.name}`);

        // 5.1 FATIAMENTO: Se o scraper retorna TODOS os episódios juntos,
        // fatiar baseado na contagem da Jikan para a temporada correta.
        const jikanEpisodeCount = metadata.episodes; // Qtd de eps que a Jikan diz que ESTA temporada tem
        
        if (jikanEpisodeCount && finalEpisodes.length > jikanEpisodeCount) {
          const hasPrequel = metadata.relations?.some(
            (r: any) => r.relation === 'Prequel' && r.entries?.some((e: any) => e.type === 'anime')
          );

          if (hasPrequel) {
            // Esta é temporada 2+ → pegar os ÚLTIMOS episódios
            finalEpisodes = finalEpisodes.slice(-jikanEpisodeCount);
            // Renumerar a partir de 1
            finalEpisodes = finalEpisodes.map((ep: any, i: number) => ({
              ...ep,
              number: i + 1,
              title: ep.title || `Episódio ${i + 1}`
            }));
            console.log(`[Bridge] ✂️ Temporada 2+ → fatiou ${scraperDetails.episodes.length} → ${finalEpisodes.length} episódios (últimos ${jikanEpisodeCount})`);
          } else {
            // Esta é temporada 1 → pegar os PRIMEIROS episódios
            finalEpisodes = finalEpisodes.slice(0, jikanEpisodeCount);
            console.log(`[Bridge] ✂️ Temporada 1 → fatiou ${scraperDetails.episodes.length} → ${finalEpisodes.length} episódios (primeiros ${jikanEpisodeCount})`);
          }
        }

        return c.json({
          source: `Hybrid (Jikan + ${matchedProvider.name})`,
          ...metadata,
          synopsis: scraperDetails.synopsis || metadata.synopsis,
          description: scraperDetails.synopsis || metadata.synopsis,
          episodes: finalEpisodes,
          animeSlug: match.id,
          provider: matchedProvider.name,
          seasons: numberedSeasons
        });
      }

      return c.json({
        source: 'Jikan (No Match)',
        ...metadata,
        episodes: [],
        seasons: numberedSeasons,
        message: 'Streaming não disponível para este anime ainda.'
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
  const title = c.req.query('title');
  
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
      let sources: any[] = [];
      
      try {
        sources = await p.extractVideoLinks(episodeId);
      } catch (err) {
        console.log(`[🎯 Multi-Hub] Falha inicial em ${p.name} (ID: ${episodeId}), tentando resgate...`);
      }

      // --- LÓGICA DE RESGATE SMART ---
      // Se falhar a extração direta (ou der erro) e tivermos o título do anime, tentamos um match dinâmico
      if ((!sources || sources.length === 0) && title) {
        console.log(`[🚑 Resgate] Slug falhou em ${p.name}. Buscando por título: ${title}`);
        const searchResults = await p.search(title);
        
        if (searchResults && searchResults.length > 0) {
          // Tenta um match mais preciso
          const match = searchResults.find(r => 
            r.title.toLowerCase().includes(title.toLowerCase()) || 
            title.toLowerCase().includes(r.title.toLowerCase())
          ) || searchResults[0];

          console.log(`[🚑 Resgate] Novo Match em ${p.name}: ${match.id}`);
          
          let newEpisodeId = match.id;
          if (p.name === 'AnimeFire') {
             newEpisodeId = `${match.id}/${episode}`;
          } else if (p.name === 'AnimesOnlineCC') {
             // AnimesOnline precisa do slug específico do episódio
             const details = await p.getEpisodes(match.id);
             const targetEp = details.episodes.find((e: any) => String(e.number) === String(episode));
             if (targetEp) newEpisodeId = targetEp.id;
          }

          console.log(`[🚑 Resgate] Tentando extração com NEW ID: ${newEpisodeId}`);
          sources = await p.extractVideoLinks(newEpisodeId);
        }
      }

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
console.log(`\n🔥 Spike Animes Api`);
console.log(`➡️  Provedores: ${videoFallbackProviders.map(p => p.name).join(', ')}`);

serve({ fetch: app.fetch, port });
