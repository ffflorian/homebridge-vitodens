import crypto from 'node:crypto';
import http from 'node:http';
import {internalIpV4} from 'internal-ip';
import {RequestService} from './RequestService';

import type {Logging as HomebridgeLogging} from 'homebridge';
import type {ViessmannAuthorization} from './@types/interfaces';
import type {StorageService} from './StorageService';

export class AuthenticationService {
  private redirectUri?: string;
  private hostIp?: string;
  private readonly codeVerifier: string;
  private readonly codeChallenge: string;

  constructor(
    private readonly log: HomebridgeLogging,
    private readonly requestService: RequestService,
    private readonly storageService: StorageService,
    private readonly clientId: string
  ) {
    this.codeVerifier = this.generateCodeVerifier();
    this.codeChallenge = this.generateCodeChallenge(this.codeVerifier);
  }

  private generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(codeVerifier: string) {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  private authenticate(): Promise<ViessmannAuthorization> {
    if (!this.redirectUri) {
      throw new Error('Got no redirect URI');
    }

    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('redirect_uri', encodeURIComponent(this.redirectUri));
    params.set('scope', encodeURIComponent('IoT User offline_access'));
    params.set('response_type', 'code');
    params.set('code_challenge_method', 'S256');
    params.set('code_challenge', this.codeChallenge);

    const authUrl = `https://iam.viessmann.com/idp/v3/authorize?${params.toString()}`;

    this.log(`Click this link for authentication: ${authUrl}`);
    return this.getCodeViaServer();
  }

  private getCodeViaServer(): Promise<ViessmannAuthorization> {
    return new Promise((resolve, reject) => {
      const server = http
        .createServer((req, res) => {
          if (!req.url) {
            throw new Error('Server got no request URL');
          }

          const url = new URL(req.url, `http://${req.headers.host}`);
          const authCode = url.searchParams.get('code');
          if (authCode) {
            this.log.debug('Received authorization code:', authCode);
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.end('Authorization successful. You can close this window.');
            this.exchangeCodeForToken(authCode)
              .then(auth => {
                server.close();
                resolve(auth);
              })
              .catch(reject);
          } else {
            res.writeHead(400, {'Content-Type': 'text/plain'});
            res.end('Authorization code not found.');
          }
        })
        .listen(4200, this.hostIp, () => {
          this.log.debug(`Server is listening on ${this.hostIp}:4200`);
        });
    });
  }

  private async exchangeCodeForToken(authCode: string): Promise<ViessmannAuthorization> {
    if (!this.redirectUri) {
      throw new Error('Got no redirect URI');
    }

    const tokenUrl = 'https://iam.viessmann.com/idp/v3/token';

    const params = new URLSearchParams();
    params.set('client_id', this.clientId);
    params.set('redirect_uri', this.redirectUri);
    params.set('grant_type', 'authorization_code');
    params.set('code_verifier', this.codeVerifier);
    params.set('code', authCode);

    this.log.debug('Exchanging authorization code for access token...');

    try {
      const response = await this.requestService.request(tokenUrl, 'post', {
        body: params,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const tokenResponse = (await response.json()) as ViessmannAuthorization;

      if (!response.ok) {
        throw new Error(JSON.stringify(tokenResponse, null, 2));
      }

      this.log.debug('Successfully exchanged code for access token.');
      return tokenResponse;
    } catch (error) {
      this.log.error('Error exchanging code for token:', error);
      throw error;
    }
  }

  public async startAuth(hostIp?: string) {
    this.log('Starting authentication process...');
    this.hostIp = hostIp || (await internalIpV4());
    this.redirectUri = `http://${this.hostIp}:4200`;
    this.log.debug(`Using redirect URI: ${this.redirectUri}`);

    try {
      const {access_token, refresh_token} = await this.authenticate();
      this.requestService.setAccessToken(access_token);
      this.requestService.setRefreshToken(refresh_token);
      await this.storageService.saveLocalStorage({refreshToken: refresh_token});
    } catch (error) {
      this.log.error('Error during authentication:', error);
      throw error;
    }

    if (this.requestService.getAccessToken()) {
      this.log('Authentication successful, received access token.');
    } else {
      this.log.error('Authentication did not succeed, received no access token.');
      return;
    }
  }
}
