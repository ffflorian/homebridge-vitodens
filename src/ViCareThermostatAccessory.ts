import type {
  CharacteristicGetCallback,
  API as HomebridgeAPI,
  Logging as HomebridgeLogging,
  PlatformConfig as HomebridgePlatformConfig,
  Service as HomebridgeService,
} from 'homebridge';

import type {LocalDevice, ViessmannAPIError, ViessmannAPIResponse, ViessmannFeature} from './@types/interfaces.js';
import {RequestService} from './RequestService.js';

export class ViCareThermostatAccessory {
  private readonly deviceId: string;
  private readonly feature: string;
  private readonly maxTemp: number;
  private readonly name?: string;
  private readonly services: HomebridgeService[];
  private readonly temperatureService: HomebridgeService;
  private readonly type: 'temperature_sensor' | 'thermostat';

  constructor(
    private readonly api: HomebridgeAPI,
    private readonly log: HomebridgeLogging,
    private readonly requestService: RequestService,
    private readonly apiEndpoint: string,
    private readonly installationId: string,
    private readonly gatewaySerial: string,
    config: HomebridgePlatformConfig & LocalDevice
  ) {
    this.name = config.name;
    this.feature = config.feature;
    this.deviceId = config.deviceId;
    this.maxTemp = config.maxTemp;
    this.type = config.type || 'temperature_sensor';

    this.temperatureService =
      this.type === 'thermostat'
        ? new this.api.hap.Service.Thermostat(
            this.name,
            `thermostatService_${this.name}_${this.feature}_${this.api.hap.uuid.generate(`${this.name}${this.feature}`)}`
          )
        : new this.api.hap.Service.TemperatureSensor(
            this.name,
            `temperatureService_${this.name}_${this.feature}_${this.api.hap.uuid.generate(`${this.name}${this.feature}`)}`
          );

    this.temperatureService
      .getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
      .on('get', this.getTemperature.bind(this));

    this.temperatureService.getCharacteristic(this.api.hap.Characteristic.TargetTemperature).setProps({
      minValue: 0,
      maxValue: this.maxTemp,
      minStep: 1,
    });

    // TODO: Once changing to eco mode is enabled, add `Characteristic.TargetHeatingCoolingState.OFF`
    this.temperatureService.getCharacteristic(this.api.hap.Characteristic.TargetHeatingCoolingState).setProps({
      minValue: this.api.hap.Characteristic.TargetHeatingCoolingState.HEAT,
      maxValue: this.api.hap.Characteristic.TargetHeatingCoolingState.HEAT,
      validValues: [this.api.hap.Characteristic.TargetHeatingCoolingState.HEAT],
    });

    // TODO: Once changing to eco mode is enabled, add `Characteristic.CurrentHeatingCoolingState.OFF` if eco mode disabled
    this.temperatureService.getCharacteristic(this.api.hap.Characteristic.CurrentHeatingCoolingState).setProps({
      minValue: this.api.hap.Characteristic.CurrentHeatingCoolingState.HEAT,
      maxValue: this.api.hap.Characteristic.CurrentHeatingCoolingState.HEAT,
      validValues: [this.api.hap.Characteristic.CurrentHeatingCoolingState.HEAT],
    });

    this.services = [this.temperatureService];
  }

  public getServices() {
    return this.services;
  }

  private async getTemperature(callback: CharacteristicGetCallback): Promise<void> {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/${this.feature}`;
    this.log.debug(`Fetching temperature from ${url} ...`);

    try {
      const response = await this.requestService.authorizedRequest(url);

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannFeature<number>> | ViessmannAPIError;

      if (!response.ok) {
        await this.requestService.checkForTokenExpiration(body as ViessmannAPIError, url);
        return;
      }

      const data = (body as ViessmannAPIResponse<ViessmannFeature<number>>).data || body;

      if (data.commands?.setTemperature?.params.targetTemperature?.constraints.min !== undefined) {
        const {min, max, stepping} = data.commands.setTemperature.params.targetTemperature.constraints;
        this.temperatureService.getCharacteristic(this.api.hap.Characteristic.TargetTemperature).setProps({
          minValue: Number(min),
          maxValue: this.maxTemp || Number(max),
          minStep: Number(stepping),
        });
      }

      if (data.properties?.value?.value !== undefined) {
        const temp = data.properties.value.value;
        callback(null, temp);
      } else if (data.properties?.temperature?.value !== undefined) {
        const temp = data.properties.temperature.value;
        callback(null, temp);
      } else {
        throw new Error(`Unexpected response structure: ${JSON.stringify(data, null, 2)}`);
      }
    } catch (error) {
      this.log.error('Error fetching temperature:', error);
      callback(error as Error);
    }
  }

  private async getBurnerStatus(callback: CharacteristicGetCallback): Promise<void> {
    const url = `${this.apiEndpoint}/features/installations/${this.installationId}/gateways/${this.gatewaySerial}/devices/${this.deviceId}/features/${this.feature}`;
    this.log.debug(`Fetching burner status from ${url} ...`);

    try {
      const response = await this.requestService.authorizedRequest(url);

      const body = (await response.json()) as ViessmannAPIResponse<ViessmannFeature<boolean>> | ViessmannAPIError;

      if (!response.ok) {
        await this.requestService.checkForTokenExpiration(body as ViessmannAPIError, url);
        return;
      }

      const data = (body as ViessmannAPIResponse<ViessmannFeature<boolean>>).data || body;
      if (data.properties?.active?.value !== undefined) {
        const isActive = data.properties.active.value;
        callback(null, isActive);
      } else {
        this.log.error('Unexpected response structure:', data);
        callback(new Error('Unexpected response structure.'));
      }
    } catch (error) {
      this.log.error('Error fetching burner status:', error);
      callback(error as Error);
    }
  }
}
