import axios from 'axios';
import { AnimeProvider, VideoSource } from './BaseProvider';

export class AnimesOnlineProvider implements AnimeProvider {
  name = 'AnimesOnlineCC';

  async search(query: string) {
    // Implementação mockada apenas para manter a interface,
    // o foco aqui é o fallback de VÍDEO.
    return [];
  }

  async getEpisodes(id: string) {
    return { title: 'Desconhecido', synopsis: '', cover: '', episodes: [] };
  }

  async extractVideoLinks(episodeUrlPath: string): Promise<VideoSource[]> {
    // Exemplo de episodeUrlPath que o Kaizen envia: "naruto-shippuden-todos-os-episodios/1"
    const parts = episodeUrlPath.split('/');
    const slug = parts[0]; 
    const episode = parts[1];

    // Montar a URL baseado na lógica do yzPeedro no SugoiAPI:
    // https://animesonlinecc.to/episodio/{slug}-episodio-{episode}
    const url = `https://animesonlinecc.to/episodio/${slug}-episodio-${episode}`;
    console.log(`[AnimesOnlineCC] Baixando a página ${url}...`);

    try {
      // Faz o request da página
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        }
      });
      const html = response.data;

      // Usar RegEx para extrair o src do iframe (mesma regex do PHP do Sugoi)
      // preg_match('#<iframe.*?src="(.*?)".*?></iframe>#is', ...
      const regex = /<iframe[^>]*src="([^"]+)"[^>]*><\/iframe>/is;
      const match = html.match(regex);

      if (match && match[1]) {
        console.log(`[AnimesOnlineCC] Iframe encontrado! ${match[1]}`);
        return [
          {
            quality: 'Iframe (Embed)',
            url: match[1]
          }
        ];
      }

      throw new Error("Iframe de vídeo não encontrado no HTML da página.");

    } catch (error: any) {
      if (error.response && error.response.status === 404) {
         throw new Error("Página 404 - Anime ou Episódio não existe no AnimesOnlineCC.");
      }
      throw new Error(`Erro ao acessar AnimesOnlineCC: ${error.message}`);
    }
  }
}
