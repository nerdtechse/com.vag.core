const Homey = require('homey');
const dottie = require('dottie');
const VwWeconnect = require('../lib/@iobroker/iobroker.vw-connect');
const { sleep, decrypt, encrypt, calcCrow, get } = require('../lib/helpers');
const capability_map = require('../constants/capability_map');

module.exports = class mainDevice extends Homey.Device {
    log() {
        console.log.bind(this, `[${Date.now()}][log]`).apply(this, arguments);
    }

    debug() {
        console.log.bind(this, `[${Date.now()}][debug]`).apply(this, arguments);
    }

    error() {
        console.log.bind(this, `[${Date.now()}][error]`).apply(this, arguments);
        if (arguments && arguments.length) {
            this.handleErrors(arguments);
        }
    }

    dummyLog() {}

    // -------------------- INIT ----------------------

    async onInit() {
        try {
            this.log('[Device] - init =>', this.getName());
            this.setUnavailable(`Starting... - ${this.getName()}`);

            await this.initStore();
            await this.checkCapabilities();
            await this.setVwWeConnectClient();

            await this.setAvailable();
        } catch (error) {
            this.log(`[Device] ${this.getName()} - OnInit Error`, error);
        }
    }

    // ------------- Settings -------------
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log(`[Device] ${this.getName()} - oldSettings`, { ...oldSettings, username: 'LOG', password: 'LOG', pin: 'LOG', vin: 'LOG' });
        this.log(`[Device] ${this.getName()} - newSettings`, { ...newSettings, username: 'LOG', password: 'LOG', pin: 'LOG', vin: 'LOG' });

        if (changedKeys.length) {
            if (this.onPollInterval) {
                this.clearIntervals();
            }

            await this.checkCapabilities(newSettings);

            if (newSettings.password !== oldSettings.password) {
                this.setVwWeConnectClient({ ...newSettings, password: encrypt(newSettings.password) });
            } else {
                this.setVwWeConnectClient(newSettings);
            }

            if (newSettings.password !== oldSettings.password) {
                this.savePassword(newSettings, 2000);
            }
        }
    }

    async savePassword(settings, delay = 0) {
        this.log(`[Device] ${this.getName()} - savePassword - encrypted`);

        if (delay > 0) {
            await sleep(delay);
        }

        await this.setSettings({ ...settings, password: encrypt(settings.password) });
    }

    // ------------- API -------------
    async setVwWeConnectClient(overrideSettings = null) {
        const settings = overrideSettings ? overrideSettings : this.getSettings();

        try {
            this.config = { ...settings, password: decrypt(settings.password) };

            this.log(`[Device] - ${this.getName()} => setVwWeConnectClient Got config`, { ...this.config, username: 'LOG', password: 'LOG', pin: 'LOG', vin: 'LOG' });

            if (this._weConnectClient) {
                this.log(`[Device] - ${this.getName()} => setVwWeConnectClient - removing old instance`);
                this._weConnectClient = null;
                await sleep(1000);
            }

            this._weConnectClient = await VwWeconnect({
                username: this.config.username,
                password: this.config.password,
                type: this.config.type,
                pin: this.config.pin,
                interval: this.config.update_interval,
                log: this.log,
                error: this.error,
                debug: settings.debug_logs ? this.debug : this.dummyLog
            });

            await this._weConnectClient.onReady();
            await sleep(6000);
            await this._weConnectClient.onUnload(() => {});
            await sleep(1000);

            await this.setRestart(false);
            await this.setCapabilityValues(true);
            await this.setAvailable();
            await this.setIntervalsAndFlows(settings);
        } catch (error) {
            this.log(`[Device] ${this.getName()} - setVwWeConnectClient - error =>`, error);
        }
    }

    // ------------- CapabilityListeners -------------
    async setCapabilityListeners(capabilities) {
        const filtered = capabilities.filter((f) => f.includes('remote_') || f.includes('locked') || f.includes('target_'));
        await this.registerMultipleCapabilityListener(filtered, this.onCapability_ACTION.bind(this));
    }

    // ----------------- Actions ------------------
    async onCapability_ACTION(value) {
        try {
            this.log(`[Device] ${this.getName()} - onCapability_ACTION`, value);

            const settings = this.getSettings();
            const { type, vin, pin } = settings;

            if (type === 'id' || type === 'audietron' || type === 'skodae' || pin.length) {
                if ('locked' in value) {
                    const val = value.locked;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.lock`, { ack: false, val: val });
                }

                if ('remote_flash' in value) {
                    const val = value.remote_flash;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.flash`, { ack: false, val: val });
                    this.setValue('remote_flash', false, 3000);
                }

                if ('remote_flash_honk' in value) {
                    const val = value.remote_flash_honk;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.honk`, { ack: false, val: val });
                    this.setValue('remote_flash_honk', false, 3000);
                }

                if ('remote_charge_min_limit' in value) {
                    const val = value.remote_charge_min_limit;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.chargeMinLimit`, { ack: false, val: val });
                }

                if ('remote_max_charge_current' in value) {
                    const val = value.remote_max_charge_current;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.maxChargeCurrent`, { ack: false, val: val });
                }

                if ('remote_battery_charge' in value) {
                    const val = value.remote_battery_charge;

                    if (type === 'id' || type === 'audietron' || type === 'skodae') {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.charging`, { ack: false, val: val });
                    } else {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.batterycharge`, { ack: false, val: val });
                    }
                }

                if ('remote_climatisation' in value) {
                    const val = value.remote_climatisation;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.climatisation`, { ack: false, val: val });
                }

                if ('remote_climatisation_v2' in value) {
                    const val = value.remote_climatisation_v2;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.climatisationv2`, { ack: false, val: val });
                }

                if ('remote_climatisation_v3' in value) {
                    const val = value.remote_climatisation_v3;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.climatisationv3`, { ack: false, val: val });
                }

                if ('remote_ventilation' in value) {
                    const val = value.remote_ventilation;

                    if (type === 'skodae') {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.air-conditioning`, { ack: false, val: val });
                    } else {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.ventilation`, { ack: false, val: val });
                    }
                }

                if ('remote_ventilation_v2' in value) {
                    const val = value.remote_ventilation_v2;

                    if (type === 'skodae') {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.air-conditioning`, { ack: false, val: val });
                    } else {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.ventilationv2`, { ack: false, val: val });
                    }
                }

                if ('remote_ventilation_v3' in value) {
                    const val = value.remote_ventilation_v3;

                    if (type === 'skodae') {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.air-conditioning`, { ack: false, val: val });
                    } else {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.ventilationv3`, { ack: false, val: val });
                    }
                }

                if ('remote_window_heating' in value) {
                    const val = value.remote_window_heating;
                    await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.windowheating`, { ack: false, val: val });
                }

                if ('target_temperature' in value) {
                    const val = value.target_temperature;

                    if (type === 'id' || type === 'audietron') {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.status.climatisationSettings.targetTemperature_C`, { ack: false, val: val });
                    } else if (type === 'skodae') {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.targetTemperatureInCelsius`, { ack: false, val: val });
                    } else {
                        await this._weConnectClient.onStateChange(`vw-connect.0.${vin}.remote.climatisationTemperature`, { ack: false, val: val });
                    }
                }

                if ('remote_force_refresh' in value) {
                    this.setCapabilityValues(true);

                    this.setValue('remote_force_refresh', false, 3000);
                }
            } else {
                throw new Error('S-PIN missing');
            }

            return Promise.resolve(true);
        } catch (e) {
            this.error(e);
            return Promise.reject(e);
        }
    }

    // ----------------- Values ------------------
    async setCapabilityValues(check = false) {
        this.log(`[Device] ${this.getName()} - setCapabilityValues`);

        try {
            const settings = this.getSettings();
            const vin = settings.vin;
            const type = settings.type;
            const forceUpdate = this.getStoreValue('forceUpdate');
            const shouldRestart = this.getStoreValue('shouldRestart');

            if (!check && shouldRestart) {
                this.log(`[Device] ${this.getName()} - setCapabilityValues - shouldRestart!`);
                this.clearIntervals();

                await this.setVwWeConnectClient();
            }

            if (check || forceUpdate >= 360) {
                this.log(`[Device] ${this.getName()} - setCapabilityValues - forceUpdate`);

                await sleep(5000);
                await this._weConnectClient.requestStatusUpdate(vin).catch(() => {
                    this.log('force status update Failed', `${this.driver.id}-${type}`);
                });
                await sleep(5000);
                await this._weConnectClient.updateStatus('setCapabilityValues force');
                await sleep(10000);

                this.setStoreValue('forceUpdate', 0).catch(this.error);
            } else {
                this.log(`[Device] ${this.getName()} - setCapabilityValues - updateStatus`);

                await this._weConnectClient.updateStatus('setCapabilityValues normal');
                await sleep(10000);

                this.setStoreValue('forceUpdate', forceUpdate + settings.update_interval).catch(this.error);
            }

            // always unload vwconnectclient to prevent double intervals
            await this._weConnectClient.onUnload(() => {});

            const deviceInfo = this._weConnectClient.getState();
            const deviceInfoTransformed = dottie.transform(deviceInfo);
            const vinData = deviceInfoTransformed[vin];
            const capabilityMapData = `${this.driver.id}-${type}` in capability_map ? capability_map[`${this.driver.id}-${type}`] : capability_map[`${this.driver.id}`];

            this.log(`[Device] ${this.getName()} - setCapabilityValues - capabilityMapData`, `${this.driver.id}-${type}`, capabilityMapData);

            if (settings.debug_logs) {
                this.debug(`[Device] ${this.getName()} - setCapabilityValues - vinData`, `${this.driver.id}-${type}`, vinData);
            }

            if (vinData && vinData.status) {
                for (const [key, value] of Object.entries(capabilityMapData)) {
                    const status = get(vinData, value, null);

                    this.log(`[Device] ${this.getName()} - getValue => ${key} => `, status);

                    if (key.includes('is_home')) {
                        const lat = get(vinData, value.latitude, 0);
                        const lng = get(vinData, value.longitude, 0);

                        this.log(`[Device] ${this.getName()} - getPos => ${key} => `, lat, lng);

                        await this.setLocation(lat, lng);
                    } else if ((status || status !== null) && typeof status == 'number') {
                        if (key.includes('_temperature') && status > 2000) {
                            await this.setValue(key, Math.round((status / 10 - 273.15) * 2) / 2);
                        } else if (key.includes('_temperature') && status > 200) {
                            await this.setValue(key, Math.round((status - 273.15) * 2) / 2);
                        } else if (key.includes('_range') && status > 2000) {
                            await this.setValue(key, status / 1000);
                        } else if (key.includes('remaining_climate_time') && type === 'skodae') {
                            await this.setValue(key, status / 60);
                        } else {
                            await this.setValue(key, Math.abs(status));
                        }
                    } else if (status || status !== null) {
                        if (key.includes('_plug_connected') && ['Connected', 'connected', 'Disconnected', 'disconnected'].includes(status)) {
                            await this.setValue(key, ['Connected', 'connected'].includes(status));
                        } else if (key.includes('is_charging') && ['Charging', 'charging', 'off', 'Off'].includes(status)) {
                            await this.setValue(key, ['Charging', 'charging'].includes(status));
                        } else {
                            await this.setValue(key, status);
                        }
                    }
                }
            }
        } catch (error) {
            this.error(error);
        }
    }

    async setLocation(lat, lng, isMoving = false) {
        try {
            const HomeyLat = this.homey.geolocation.getLatitude();
            const HomeyLng = this.homey.geolocation.getLongitude();
            const setLocation = calcCrow(HomeyLat, HomeyLng, parseFloat(lat / 1000000), parseFloat(lng / 1000000));

            if (isMoving) {
                await this.setValue('is_home', false);
            } else {
                await this.setValue('is_home', setLocation <= 1);
            }
        } catch (error) {
            this.log(error);
        }
    }

    async setValue(key, value, delay = 0) {
        this.log(`[Device] ${this.getName()} - setValue => ${key} => `, value);
        const oldVal = await this.getCapabilityValue(key);

        this.log(`[Device] ${this.getName()} - setValue - oldValue => ${key} => `, oldVal, value);

        if (delay) {
            await sleep(delay);
        }

        await this.setCapabilityValue(key, value);

        if (typeof value === 'boolean' && key.startsWith('is_') && oldVal !== value) {
            await this.homey.flow
                .getDeviceTriggerCard(`${key}_changed`)
                .trigger(this, { [`${key}`]: value })
                .catch(this.error)
                .then(this.log(`[Device] ${this.getName()} - setValue ${key}_changed - Triggered: "${key} | ${value}"`));
        }
    }

    // ----------------- Errors ------------------
    handleErrors(args) {
        if (this.getAvailable()) {
            if (this._weConnectClient && args[0] && typeof args[0] === 'string' && args[0].includes('Refresh Token in 10min')) {
                this.log(`[Device] ${this.getName()} - handleErrors - refreshing token`);
                this._weConnectClient.refreshToken(true).catch(() => {
                    this.log('Refresh Token was not successful');
                });
            }

            if (args[0] && typeof args[0] === 'string' && args[0].includes('Restart adapter in')) {
                this.log(`[Device] ${this.getName()} - handleErrors Try to Restart Adapter`);

                const shouldRestart = this.getStoreValue('shouldRestart');

                if (!shouldRestart) {
                    this.log(`[Device] ${this.getName()} - Try to Restart Adapter`);
                    this.setRestart(true);
                } else {
                    this.log(`[Device] ${this.getName()} - Restart Adapter already scheduled`);
                }
            }
        }
    }

    // ------------- Intervals -------------
    async setIntervalsAndFlows(settings) {
        try {
            if (this.getAvailable()) {
                await this.setCapabilityValuesInterval(settings.update_interval);
            }
        } catch (error) {
            this.log(`[Device] ${this.getName()} - OnInit Error`, error);
        }
    }

    async setCapabilityValuesInterval(update_interval) {
        try {
            const REFRESH_INTERVAL = 60000 * update_interval;

            this.log(`[Device] ${this.getName()} - onPollInterval =>`, REFRESH_INTERVAL, update_interval);
            this.onPollInterval = setInterval(this.setCapabilityValues.bind(this), REFRESH_INTERVAL);
        } catch (error) {
            this.setUnavailable(error);
            this.log(error);
        }
    }

    async clearIntervals() {
        this.log(`[Device] ${this.getName()} - clearIntervals`);
        await clearInterval(this.onPollInterval);
    }

    // ------------- Capabilities -------------
    async checkCapabilities(overrideSettings = null) {
        const settings = overrideSettings ? overrideSettings : this.getSettings();
        const driverCapabilities = this.driver.manifest.capabilities;
        const deviceCapabilities = this.getCapabilities();
        const capabilityMapData = `${this.driver.id}-${settings.type}` in capability_map ? capability_map[`${this.driver.id}-${settings.type}`] : capability_map[`${this.driver.id}`];
        let settingsCapabilities = Object.keys(settings).filter((s) => s.startsWith('remote_') || s.startsWith('measure_'));
        settingsCapabilities = settingsCapabilities.filter((c) => (settings[c] ? true : false));
        const combinedCapabilities = [...new Set([...driverCapabilities, ...Object.keys(capabilityMapData), ...settingsCapabilities])];

        this.log(`[Device] ${this.getName()} - Device capabilities =>`, deviceCapabilities);
        this.log(`[Device] ${this.getName()} - Combined capabilities =>`, combinedCapabilities);

        await this.updateCapabilities(combinedCapabilities, deviceCapabilities);

        await this.setCapabilityListeners(combinedCapabilities);

        return combinedCapabilities;
    }

    async updateCapabilities(combinedCapabilities, deviceCapabilities) {
        try {
            const newC = combinedCapabilities.filter((d) => !deviceCapabilities.includes(d));
            const oldC = deviceCapabilities.filter((d) => !combinedCapabilities.includes(d));

            this.log(`[Device] ${this.getName()} - Got old capabilities =>`, oldC);
            this.log(`[Device] ${this.getName()} - Got new capabilities =>`, newC);

            oldC.forEach((c) => {
                this.log(`[Device] ${this.getName()} - updateCapabilities => Remove `, c);
                this.removeCapability(c);
            });
            await sleep(2000);
            newC.forEach((c) => {
                this.log(`[Device] ${this.getName()} - updateCapabilities => Add `, c);
                this.addCapability(c);
            });
            await sleep(2000);
        } catch (error) {
            this.log(error);
        }
    }

    async initStore() {
        const forceUpdate = this.getStoreValue('forceUpdate');
        if (!forceUpdate) {
            this.setStoreValue('forceUpdate', 0).catch(this.error);
        }

        this.setRestart(false);
    }

    async setRestart(val) {
        this.log(`[Device] ${this.getName()} - setRestart`, val);
        this.setStoreValue('shouldRestart', val).catch(this.error);
    }

    onDeleted() {
        this.clearIntervals();
    }
};
