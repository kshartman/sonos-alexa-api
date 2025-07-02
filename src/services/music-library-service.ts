import { XMLParser } from 'fast-xml-parser';
import logger from '../utils/logger.js';

interface BrowseResult {
  items: MusicItem[];
  totalMatches: number;
}

interface MusicItem {
  type: 'container' | 'item';
  id: string;
  parentID: string;
  title: string;
  artist?: string;
  album?: string;
  res?: string;
  albumArtURI?: string;
  class?: string;
  childCount?: number;
}

export interface MusicSearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  uri: string;
  albumArtURI?: string;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true
});

export class MusicLibraryService {
  private deviceIP: string;

  constructor(deviceIP: string) {
    this.deviceIP = deviceIP;
  }

  async searchLibrary(
    keyword: string,
    field: 'title' | 'artist' | 'album' = 'title',
    maxResults: number = 50
  ): Promise<MusicSearchResult[]> {
    logger.debug(`Searching music library for ${field}: "${keyword}"`);
    
    try {
      let results: MusicItem[] = [];
      
      // Use the appropriate index based on search field
      switch (field) {
      case 'title':
        // For title search, we need to browse through albums or tracks
        // Using A:ALBUM is more efficient than A:TRACKS for large libraries
        results = await this.searchByTitle(keyword, maxResults);
        break;
          
      case 'artist':
        // Use the artist index
        results = await this.searchByArtist(keyword, maxResults);
        break;
          
      case 'album':
        // Use the album index
        results = await this.searchByAlbum(keyword, maxResults);
        break;
      }
      
      // Convert to search results format
      return results.slice(0, maxResults).map(item => {
        const result: MusicSearchResult = {
          id: item.id,
          title: item.title,
          artist: item.artist || '',
          album: item.album || '',
          uri: item.res || ''
        };
        
        if (item.albumArtURI) {
          result.albumArtURI = item.albumArtURI;
        }
        
        return result;
      });
    } catch (error) {
      logger.error('Music library search failed:', error);
      throw new Error('Failed to search music library');
    }
  }

  private async searchByArtist(keyword: string, maxResults: number): Promise<MusicItem[]> {
    const results: MusicItem[] = [];
    const searchText = keyword.toLowerCase();
    
    // Browse all artists
    let startingIndex = 0;
    let hasMore = true;
    
    while (hasMore && results.length < maxResults) {
      const { items, totalMatches } = await this.browse('A:ARTISTS', startingIndex, 100);
      
      // Find matching artists
      const matchingArtists = items.filter(item => 
        item.title.toLowerCase().includes(searchText)
      );
      
      // For each matching artist, get their albums
      for (const artist of matchingArtists) {
        if (results.length >= maxResults) break;
        
        const { items: albums } = await this.browseInternal(artist.id, 0, 100);
        
        // For each album, get tracks
        for (const album of albums) {
          if (results.length >= maxResults) break;
          
          const { items: tracks } = await this.browseInternal(album.id, 0, 100);
          results.push(...tracks.filter(t => t.type === 'item'));
        }
      }
      
      startingIndex += items.length;
      hasMore = startingIndex < totalMatches && items.length > 0;
    }
    
    return results;
  }

  private async searchByAlbum(keyword: string, maxResults: number): Promise<MusicItem[]> {
    const results: MusicItem[] = [];
    const searchText = keyword.toLowerCase();
    
    // Browse all albums
    let startingIndex = 0;
    let hasMore = true;
    
    while (hasMore && results.length < maxResults) {
      const { items, totalMatches } = await this.browseInternal('A:ALBUM', startingIndex, 100);
      
      // Find matching albums
      const matchingAlbums = items.filter(item => 
        item.title.toLowerCase().includes(searchText)
      );
      
      // For each matching album, get tracks
      for (const album of matchingAlbums) {
        if (results.length >= maxResults) break;
        
        const { items: tracks } = await this.browse(album.id, 0, 100);
        results.push(...tracks.filter(t => t.type === 'item'));
      }
      
      startingIndex += items.length;
      hasMore = startingIndex < totalMatches && items.length > 0;
    }
    
    return results;
  }

  private async searchByTitle(keyword: string, maxResults: number): Promise<MusicItem[]> {
    const results: MusicItem[] = [];
    const searchText = keyword.toLowerCase();
    
    // For title search, browse through albums and check tracks
    // This is more efficient than using A:TRACKS which could be huge
    let startingIndex = 0;
    let hasMore = true;
    
    while (hasMore && results.length < maxResults) {
      const { items: albums, totalMatches } = await this.browseInternal('A:ALBUM', startingIndex, 50);
      
      // For each album, check its tracks
      for (const album of albums) {
        if (results.length >= maxResults) break;
        
        const { items: tracks } = await this.browseInternal(album.id, 0, 1000);
        const matchingTracks = tracks.filter(track => 
          track.type === 'item' && 
          track.title.toLowerCase().includes(searchText)
        );
        
        results.push(...matchingTracks);
      }
      
      startingIndex += albums.length;
      hasMore = startingIndex < totalMatches && albums.length > 0;
    }
    
    return results.slice(0, maxResults);
  }

  async browseLibrary(containerID: string = '0'): Promise<MusicItem[]> {
    const { items } = await this.browse(containerID);
    return items;
  }

  async browse(
    objectID: string,
    startingIndex: number = 0,
    requestedCount: number = 100
  ): Promise<BrowseResult> {
    return this.browseInternal(objectID, startingIndex, requestedCount);
  }


  private async browseInternal(
    objectID: string,
    startingIndex: number = 0,
    requestedCount: number = 100
  ): Promise<BrowseResult> {
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"
                s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
          <ObjectID>${objectID}</ObjectID>
          <BrowseFlag>BrowseDirectChildren</BrowseFlag>
          <Filter>*</Filter>
          <StartingIndex>${startingIndex}</StartingIndex>
          <RequestedCount>${requestedCount}</RequestedCount>
          <SortCriteria></SortCriteria>
        </u:Browse>
      </s:Body>
    </s:Envelope>`;

    const response = await fetch(`http://${this.deviceIP}:1400/MediaServer/ContentDirectory/Control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'SOAPACTION': '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"'
      },
      body: soapBody
    });

    if (!response.ok) {
      throw new Error(`Browse failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const parsed = xmlParser.parse(text);
    
    // Navigate through the response structure
    const envelope = parsed['s:Envelope'] || parsed['SOAP-ENV:Envelope'];
    const body = envelope?.['s:Body'] || envelope?.['SOAP-ENV:Body'];
    
    // Check for SOAP faults
    const fault = body?.['s:Fault'] || body?.['SOAP-ENV:Fault'];
    if (fault) {
      const errorCode = fault.detail?.UPnPError?.errorCode;
      const errorMsg = fault.faultstring || 'Unknown error';
      throw new Error(`SOAP Fault ${errorCode}: ${errorMsg}`);
    }
    
    const browseResponse = body?.['u:BrowseResponse'];
    if (!browseResponse) {
      return { items: [], totalMatches: 0 };
    }
    
    const result = browseResponse.Result;
    const totalMatches = parseInt(browseResponse.TotalMatches) || 0;
    
    if (!result || result === '') {
      return { items: [], totalMatches };
    }
    
    // Parse the DIDL-Lite content
    const didl = xmlParser.parse(result);
    const containers = didl['DIDL-Lite']?.container;
    const items = didl['DIDL-Lite']?.item;
    
    const results: MusicItem[] = [];
    
    // Handle containers
    if (containers) {
      const containerArray = Array.isArray(containers) ? containers : [containers];
      containerArray.forEach(container => {
        results.push({
          type: 'container',
          id: container['@_id'],
          parentID: container['@_parentID'],
          title: container['dc:title'] || '',
          childCount: parseInt(container['@_childCount']) || 0,
          class: container['upnp:class'] || ''
        });
      });
    }
    
    // Handle items (tracks)
    if (items) {
      const itemArray = Array.isArray(items) ? items : [items];
      itemArray.forEach(item => {
        results.push({
          type: 'item',
          id: item['@_id'],
          parentID: item['@_parentID'],
          title: item['dc:title'] || '',
          artist: item['upnp:artist'] || item['dc:creator'] || '',
          album: item['upnp:album'] || '',
          res: item.res?.['#text'] || item.res || '',
          albumArtURI: item['upnp:albumArtURI'] || '',
          class: item['upnp:class'] || ''
        });
      });
    }
    
    return { items: results, totalMatches };
  }
}