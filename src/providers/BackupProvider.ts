import { AnimeProvider, AnimeResult, EpisodeResult, VideoSource } from './BaseProvider';

// Esse provedor de teste é ativado apenas se o principal (AnimeFire) falhar no Fallback Loop
// Ele é perfeitamente replicável para AnimesOnline.cc ou AnimesVision
export class BackupProvider extends AnimeProvider {
  name = 'AnimesVision (Mock Backup)';

  async search(query: string): Promise<AnimeResult[]> { return []; }
  async getEpisodes(id: string) { return { title: '', synopsis: '', cover: '', episodes: [] }; }
  
  async extractVideoLinks(episodeId: string): Promise<VideoSource[]> {
      // Simula uma espera de raspagem (Ex: acessando puppeteer no AnimesVision)
      const urlDeBackup = "https://backup-link.mp4";
      
      throw new Error("O Scraper do BackupProvider também encontrou bloqueios ou não está implementado 100%.");
  }
}
