import type {
  API as HomebridgeAPI,
  Characteristic as HomebridgeCharacteristic,
  DynamicPlatformPlugin as HomebridgeDynamicPlatformPlugin,
  Logging as HomebridgeLogging,
  PlatformAccessory as HomebridgePlatformAccessory,
  PlatformConfig as HomebridgePlatformConfig,
  Service as HomebridgeService,
} from 'homebridge';

import {ExamplePlatformAccessory} from './platformAccessory.js';
import {PLATFORM_NAME, PLUGIN_NAME} from './settings.js';
import {RequestService} from './RequestService.js';
import {StorageService} from './StorageService.js';
import {AuthenticationService} from './AuthenticationService.js';

const clientId = 'a516fff2622fd70cb714e8a356c4964e';

export class ExampleHomebridgePlatform implements HomebridgeDynamicPlatformPlugin {
  public readonly Service: typeof HomebridgeService;
  public readonly Characteristic: typeof HomebridgeCharacteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, HomebridgePlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  private readonly authenticationService: AuthenticationService;
  private readonly requestService: RequestService;
  private readonly storageService: StorageService;

  constructor(
    public readonly log: HomebridgeLogging,
    public readonly config: HomebridgePlatformConfig,
    public readonly api: HomebridgeAPI
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.storageService = new StorageService(this.api, this.log);
    this.requestService = new RequestService(this.log, clientId);
    this.authenticationService = new AuthenticationService(
      this.log,
      this.requestService,
      this.storageService,
      clientId
    );

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', async () => {
      this.log.debug('Executed didFinishLaunching callback');
      await this.storageService.initialize();
      await this.authenticationService.startAuth();
      await this.requestService.refreshAuth();
      await this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: HomebridgePlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices(): Promise<void> {
    // EXAMPLE ONLY
    // A real plugin you would discover accessories from the local network, cloud services
    // or a user-defined array in the platform config.
    const exampleDevices = [
      {
        exampleUniqueId: 'ABCD',
        exampleDisplayName: 'Bedroom',
      },
      {
        exampleUniqueId: 'EFGH',
        exampleDisplayName: 'Kitchen',
      },
      {
        // This is an example of a device which uses a Custom Service
        exampleUniqueId: 'IJKL',
        exampleDisplayName: 'Backyard',
        CustomService: 'AirPressureSensor',
      },
    ];

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of exampleDevices) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.exampleUniqueId);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. e.g.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new ExamplePlatformAccessory(this, existingAccessory);

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, e.g.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.exampleDisplayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.exampleDisplayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new ExamplePlatformAccessory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      // push into discoveredCacheUUIDs
      this.discoveredCacheUUIDs.push(uuid);
    }

    // you can also deal with accessories from the cache which are no longer present by removing them from Homebridge
    // for example, if your plugin logs into a cloud account to retrieve a device list, and a user has previously removed a device
    // from this cloud account, then this device will no longer be present in the device list but will still be in the Homebridge cache
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
