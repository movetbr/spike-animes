import { AnimeProvider, AnimeResult, EpisodeResult, VideoSource } from './BaseProvider';

// Esse provedor de teste é ativado apenas se o principal (AnimeFire) falhar no Fallback Loop
// Ele é perfeitamente replicável para AnimesOnline.cc ou AnimesVision
export class BackupProvider extends AnimeProvider {
  name = 'AnimesVision (Mock Backup)';
  baseUrl = 'https://animesvision.cc';

  async search(query: string): Promise<AnimeResult[]> { return []; }
  async getHome(): Promise<any> { return { sections: [] }; }
  async getEpisodes(id: string) { return { title: '', synopsis: '', cover: '', episodes: [] }; }
  
  async extractVideoLinks(episodeId: string): Promise<VideoSource[]> {
      throw new Error("O Scraper do BackupProvider não está implementado 100%.");
  }
}
