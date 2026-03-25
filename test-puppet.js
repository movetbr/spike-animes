const axios = require('axios');
const cheerio = require('cheerio');

(async () => {
  // 1. Buscar um anime real
  const { data: searchHtml } = await axios.get('https://animefire.plus/pesquisar/naruto', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const $ = cheerio.load(searchHtml);
  const firstLink = $('div.divCardUltimosEps a').first().attr('href');
  console.log('Link do anime:', firstLink);

  if (!firstLink) {
    console.log('Nenhum resultado encontrado na busca');
    return;
  }

  // 2. Pegar os episódios da página do anime
  const { data: animeHtml } = await axios.get(firstLink, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $a = cheerio.load(animeHtml);
  
  // Extrair slug dos links de episódios
  const epLinks = [];
  $a('div.div_video_list a, a.lEp.epT').each((i, el) => {
    if (i < 3) epLinks.push($a(el).attr('href'));
  });
  console.log('Primeiros episódios:', epLinks);

  if (epLinks.length > 0) {
    // 3. Extrair slug do link do episódio
    const match = epLinks[0].match(/\/animes\/([^/]+)\//);
    if (match) {
      const slug = match[1];
      console.log('Slug extraído:', slug);

      // 4. Testar a API de video
      const videoUrl = `https://animefire.plus/video/${slug}/1`;
      console.log('Testando API de video:', videoUrl);
      const { data: videoJson } = await axios.get(videoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log('Resposta da API:', JSON.stringify(videoJson, null, 2).substring(0, 800));
    }
  }
})();
