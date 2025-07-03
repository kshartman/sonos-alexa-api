import { request as nodeHttpRequest, RequestOptions } from 'http';
import { request as nodeHttpsRequest } from 'https';
import { URL } from 'url';
import logger from './logger.js';

export interface HttpRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

/**
 * Make an HTTP/HTTPS request
 */
export async function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  const url = new URL(options.url);
  const isHttps = url.protocol === 'https:';
  const requestFn = isHttps ? nodeHttpsRequest : nodeHttpRequest;

  const requestOptions: RequestOptions = {
    hostname: url.hostname,
    port: url.port ? parseInt(url.port) : (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: options.method || 'GET',
    headers: options.headers || {},
    timeout: options.timeout || 10000
  };

  return new Promise((resolve, reject) => {
    const req = requestFn(requestOptions, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers as Record<string, string | string[]>,
          body
        });
      });
    });

    req.on('error', (error: Error) => {
      logger.error(`HTTP request failed: ${error.message}`);
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${options.timeout}ms`));
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}