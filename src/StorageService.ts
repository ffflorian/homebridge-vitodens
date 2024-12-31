import {promises as fs} from 'node:fs';
import path from 'node:path';

import type {Logging as HomebridgeLogging, API as HomebridgeAPI} from 'homebridge';
import type {LocalStorage} from './@types/interfaces';

export class StorageService {
  private readonly localStoragePath: string;
  private localStorage: LocalStorage;
  private isInitialized: boolean;

  constructor(
    private readonly api: HomebridgeAPI,
    private readonly log: HomebridgeLogging
  ) {
    this.localStoragePath = path.join(api.user.storagePath(), 'homebridge-vicare-2-settings.json');
    this.localStorage = {};
    this.isInitialized = false;
  }

  public async initialize(): Promise<void> {
    this.localStorage = await this.loadLocalStorage();
    this.isInitialized = true;
  }

  public async saveLocalStorage(storage: LocalStorage): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Not initialized yet');
    }

    this.log.debug('Saving local storage ...');
    const completeConfig = {...this.localStorage, ...storage};

    try {
      await fs.writeFile(this.localStoragePath, JSON.stringify(completeConfig), 'utf-8');
    } catch (error) {
      this.log.warn('Error while saving local storage:', error);
      return;
    }

    this.log.debug('Successfully saved local storage.');
  }

  public async loadLocalStorage(): Promise<LocalStorage> {
    if (!this.isInitialized) {
      throw new Error('Not initialized yet');
    }

    this.log.debug('Loading local storage ...');

    let storageFileRaw: string | undefined;
    let storage: LocalStorage = {};

    try {
      storageFileRaw = await fs.readFile(this.localStoragePath, 'utf-8');
    } catch {
      this.log.debug('No storage file found, creating ...');
      await fs.writeFile(this.localStoragePath, '{}', 'utf-8');
    }

    if (storageFileRaw) {
      try {
        storage = JSON.parse(storageFileRaw);
      } catch {
        this.log.warn(`Storage file "${this.localStoragePath}" is not valid JSON`);
      }
    } else {
      this.log.debug('No storage file found, creating ...');
      await fs.writeFile(this.localStoragePath, '{}', 'utf-8');
    }

    return storage;
  }
}
