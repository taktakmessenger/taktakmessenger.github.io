declare module 'webtorrent' {
  export default class WebTorrent {
    constructor();
    add(magnetURI: string, options: any, callback: (torrent: any) => void): void;
    seed(file: any, options: any, callback: (torrent: any) => void): void;
    get(magnetURI: string): any;
  }
}

declare namespace WebTorrent {
  export interface Instance {
    add(magnetURI: string, options: any, callback: (torrent: any) => void): void;
    seed(file: any, options: any, callback: (torrent: any) => void): void;
    get(magnetURI: string): any;
  }
  export interface Torrent {
    infoHash: string;
    magnetURI: string;
    files: any[];
    on(event: string, callback: (...args: any[]) => void): void;
    progress: number;
  }
}
