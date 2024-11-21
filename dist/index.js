"use strict";
/**********************************************************************
 * Copyright 2023 Paul Reeve <preeve@pdjr.eu>
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you
 * may not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const net = require("net");
const sprintf_js_1 = require("sprintf-js");
const signalk_libdelta_1 = require("signalk-libdelta");
const PLUGIN_ID = 'devantech';
const PLUGIN_NAME = 'pdjr-skplugin-devantech';
const PLUGIN_DESCRIPTION = 'Signal K interface to the Devantech DS range of general-purpose relay modules';
const PLUGIN_SCHEMA = {
    "type": "object",
    "properties": {
        "clientIpFilter": {
            "title": "Client IP filter",
            "description": "Regular expression used to authenticate incoming client connections.",
            "type": "string"
        },
        "statusListenerPort": {
            "title": "Status listener port",
            "description": "TCP port on which the plugin will listen for device status updates.",
            "type": "number",
            "default": 28241
        },
        "transmitQueueHeartbeat": {
            "title": "Transmit queue heartbeat",
            "description": "Interval in milliseconds between consecutive transmit queue processing tasks.",
            "type": "number",
            "default": 25
        },
        "defaultDeviceId": {
            "title": "Default device ID",
            "description": "",
            "type": "string",
            "default": "DS"
        },
        "defaultCommandPort": {
            "title": "Default command port",
            "description": "Remote TCP port to which module operating commands will be directed by default.",
            "type": "number",
            "default": 17123
        },
        "modules": {
            "title": "Module configurations",
            "type": "array",
            "items": {
                "type": "object",
                "required": ["ipAddress", "description", "channels"],
                "properties": {
                    "ipAddress": {
                        "title": "IP address",
                        "description": "IP address of the module to which this configuration applies.",
                        "type": "string"
                    },
                    "deviceId": {
                        "title": "Device ID",
                        "description": "ID of the type of the remote device (overrides any default).",
                        "type": "string"
                    },
                    "commandPort": {
                        "title": "Command port",
                        "description": "Command port on the remote device (overrides any default).",
                        "type": "number"
                    },
                    "description": {
                        "title": "Description",
                        "description": "Description of this module.",
                        "type": "string"
                    },
                    "channels": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "index": {
                                    "title": "Index",
                                    "description": "Signal K channel index to which this configuration applies.",
                                    "type": "string"
                                },
                                "description": {
                                    "title": "Description",
                                    "description": "Description of this channel.",
                                    "type": "string"
                                }
                            }
                        }
                    }
                }
            }
        },
        "devices": {
            "title": "Device definitions",
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "channels"],
                "properties": {
                    "id": {
                        "title": "Device identifier",
                        "type": "string"
                    },
                    "relays": {
                        "title": "Number of supported relay channels",
                        "type": "number"
                    },
                    "switches": {
                        "title": "Number of supported switch channels",
                        "type": "number"
                    },
                    "channels": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "address": {
                                    "title": "Relay channel address/index",
                                    "type": "number"
                                },
                                "oncommand": {
                                    "title": "ON command",
                                    "type": "string"
                                },
                                "offcommand": {
                                    "title": "OFF command",
                                    "type": "string"
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    "default": {
        "devices": [
            {
                "id": "DS",
                "relays": 32,
                "switches": 8,
                "channels": [
                    {
                        "address": 0,
                        "oncommand": "SR {c} ON",
                        "offcommand": "SR {c} OFF"
                    }
                ]
            },
            {
                "id": "DS2824",
                "relays": 24,
                "switches": 8,
                "channels": [
                    {
                        "address": 0,
                        "oncommand": "SR {c} ON",
                        "offcommand": "SR {c} OFF"
                    }
                ]
            }
        ]
    }
};
const PLUGIN_UISCHEMA = {};
const DEFAULT_STATUS_LISTENER_PORT = 28241;
const DEFAULT_CLIENT_IP_FILTER = '.*';
const DEFAULT_TRANSMIT_QUEUE_HEARTBEAT = 25;
const DEFAULT_COMMAND_PORT = 17123;
const DEFAULT_DEVICE_ID = 'DS';
const FETCH_RESPONSES = {
    200: "OK",
    201: "Created",
    207: "Multi-Status",
    400: "Bad Request",
    404: "Not Found",
    503: "Service Unavailable",
    500: "Internal Server Error"
};
module.exports = function (app) {
    var appOptions = undefined;
    var appState = {
        clientFilterRegExp: undefined,
        statusListener: undefined,
        transmitQueueTimer: undefined,
        modules: []
    };
    const plugin = {
        id: PLUGIN_ID,
        name: PLUGIN_NAME,
        description: PLUGIN_DESCRIPTION,
        schema: PLUGIN_SCHEMA,
        uiSchema: PLUGIN_UISCHEMA,
        start: function (options) {
            console.log("Starting...");
            appOptions = options;
            try {
                appState.statusListener = startStatusListener((appOptions.statusListenerPort) ? appOptions.statusListenerPort : DEFAULT_STATUS_LISTENER_PORT);
                try {
                    appState.clientFilterRegExp = new RegExp((appOptions.clientIpFilter) ? appOptions.clientIpFilter : DEFAULT_CLIENT_IP_FILTER);
                    appState.transmitQueueTimer = setInterval(() => { processCommandQueues(); }, ((appOptions.transmitQueueHeartbeat) ? appOptions.transmitQueueHeartbeat : DEFAULT_TRANSMIT_QUEUE_HEARTBEAT));
                    appState.modules = {};
                    app.setPluginStatus(`Started: listening for DS module connections on ${appOptions.statusListenerPort}`);
                }
                catch (e) {
                    app.setPluginStatus('Stopped: error starting transmit queue processor');
                    app.debug(`error starting transmit queue processor: ${e.message}`);
                    appState.statusListener.close();
                }
            }
            catch (e) {
                app.setPluginStatus('Stopped: error starting connection listener');
                app.debug(`error starting connection listener: ${e.message}`);
            }
        },
        stop: function () {
            Object.keys(appState.modules).forEach((key) => {
                if (appState.modules[key].listenerConnection)
                    appState.modules[key].listenerConnection.destroy();
                if (appState.modules[key].commandConnection)
                    appState.modules.commandConnection.destroy();
            });
            if (appState.statusListener)
                appState.statusListener.close();
            clearTimeout(appState.transmitQueueTimer);
        },
        registerWithRouter: function (router) {
            router.get('/status', (req, res) => handleExpress(req, res, expressGetStatus));
        },
        getOpenApi: function () {
            return (require("../resources/openApi.json"));
        }
    }; // End of plugin
    function handleExpress(req, res, handler) {
        app.debug(`processing ${req.method} request on '${req.path}`);
        handler(req, res);
    }
    function expressGetStatus(req, res) {
        const body = Object.keys(appState.modules).reduce((a, id) => {
            a[id] = {
                address: appState.modules[id].ipAddress,
                relayCount: appState.modules[id].relayCount,
                switchCount: appState.modules[id].switchCount,
                connected: (appState.modules[id].commandConnection) ? true : false
            };
            return (a);
        }, {});
        expressSend(res, 200, body, req.path);
    }
    function expressSend(res, code, body = null, debugPrefix = null) {
        res.status(code).send((body) ? body : ((FETCH_RESPONSES[code]) ? FETCH_RESPONSES[code] : null));
        if (debugPrefix)
            app.debug("%s: %d %s", debugPrefix, code, ((body) ? JSON.stringify(body) : ((FETCH_RESPONSES[code]) ? FETCH_RESPONSES[code] : null)));
        return (false);
    }
    function startStatusListener(port) {
        var retval = net.createServer().listen(port);
        retval.on('connection', (client) => {
            var module;
            if (client.remoteAddress) {
                var clientIp = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
                app.debug(`processing connection attempt from ${clientIp}`);
                if ((appState.clientFilterRegExp) && (appState.clientFilterRegExp.test(clientIp))) {
                    module = getModule(clientIp);
                    publishModuleMetadata(module);
                    if (module.listenerConnection)
                        module.listenerConnection.destroy();
                    module.listenerConnection = client;
                    if ((module.commandPort) && (!module.commandConnection))
                        openCommandConnection(module);
                    client.on('data', (data) => {
                        try {
                            if (module) {
                                const messageLines = data.toString().split('\n');
                                const relayStates = messageLines[1].trim().slice(0, getRelayCount(module));
                                const switchStates = messageLines[2].replaceAll(' ', '').trim().slice(0, getSwitchCount(module));
                                var delta = new signalk_libdelta_1.Delta(app, app.plugin.id);
                                for (var i = 0; i < relayStates.length; i++) {
                                    delta.addValue(`${module.switchbankPath}.${i + 1}R.order`, (i + 1));
                                    delta.addValue(`${module.switchbankPath}.${i + 1}R.state`, ((relayStates.charAt(i) == '0') ? 0 : 1));
                                }
                                for (var i = 0; i < switchStates.length; i++) {
                                    delta.addValue(`${module.switchbankPath}.${i + 1}S.order`, (i + 1));
                                    delta.addValue(`${module.switchbankPath}.${i + 1}S.state`, ((switchStates.charAt(i) == '0') ? 0 : 1));
                                }
                                delta.commit().clear();
                            }
                            else {
                                throw new Error('client is not a module');
                            }
                        }
                        catch (e) {
                            app.debug(`error processing data from ${clientIp} (${e.message})`);
                        }
                    });
                    client.on('close', () => {
                        if (client.remoteAddress) {
                            var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
                            var moduleId = (0, sprintf_js_1.sprintf)('%03d%03d%03d%03d', clientIP.split('.')[0], clientIP.split('.')[1], clientIP.split('.')[2], clientIP.split('.')[3]);
                            var module = appState.modules[moduleId];
                            if (module) {
                                app.debug(`status listener: closing connection for ${clientIP}`);
                                module.listenerConnection.destroy();
                                module.listenerConnection = null;
                            }
                        }
                    });
                }
                else {
                    app.setPluginError(`Rejecting connection attempt from ${clientIp}`);
                    client.destroy();
                }
            }
        });
        return (retval);
    }
    function getModule(ipAddress) {
        var module;
        if (ipAddress2moduleId(ipAddress) in appState.modules) {
            return (appState.modules[ipAddress2moduleId(ipAddress)]);
        }
        else {
            module = {
                id: ipAddress2moduleId(ipAddress),
                deviceId: (appOptions.modules.reduce((a, m) => (((m.ipAddress) && (m.devideId) && (m.ipAddress == ipAddress)) ? m.deviceId : a), undefined) || appOptions.defaultDeviceId || DEFAULT_DEVICE_ID),
                description: (appOptions.modules.reduce((a, m) => (((m.ipAddress) && (m.description) && (m.ipAddress == ipAddress)) ? m.description : a), undefined) || `Devantech DS switchbank at '${ipAddress}'`),
                ipAddress: ipAddress,
                switchbankPath: `electrical.switches.bank.${ipAddress2moduleId(ipAddress)}`,
                commandPort: (appOptions.modules.reduce((a, m) => (((m.ipAddress) && (m.commandPort) && (m.ipAddress == ipAddress)) ? m.commandPort : a), undefined) || appOptions.defaultCommandPort || DEFAULT_COMMAND_PORT),
                commandConnection: null,
                commandQueue: [],
                currentCommand: undefined,
                listenerConnection: null,
                channels: {}
            };
            app.debug(JSON.stringify(module, null, 2));
            // To configure the channels array we need to get the
            // device details which relate to this module.
            var device = appOptions.devices.reduce((a, d) => { return ((d.id == module.deviceId) ? d : a); }, undefined);
            if (device) {
                // And now process the channels...
                for (var i = 0; i < device.relays; i++) {
                    module.channels[`${i + 1}R`] = {
                        id: `${i + 1}R`,
                        type: 'relay',
                        description: getChannelDescription(app.plugin.appOptions.modules[ipAddress].channels, `${i + 1}R`),
                        path: `${module.switchbankPath}.${i + 1}R.state`,
                        onCommand: getChannelOnCommand(device, i + 1),
                        offCommand: getChannelOffCommand(device, i + 1)
                    };
                }
                for (var i = 0; i < device.switches; i++) {
                    module.channels[`${i + 1}S`] = {
                        id: `${i + 1}R`,
                        type: 'switch',
                        description: getChannelDescription(appOptions.modules[ipAddress].channels, `${i + 1}S`),
                        path: `${module.switchbankPath}.${i + 1}S.state`
                    };
                }
                return (module);
            }
            else {
                throw new Error('bad device specification');
            }
        }
    }
    function publishModuleMetadata(module) {
        var delta = new signalk_libdelta_1.Delta(app, app.plugin.id);
        let metadata = {
            description: module.description,
            instance: module.id,
            device: module.deviceId,
            shortName: module.id,
            longName: `Module ${module.id}`,
            displayName: `Module ${module.id}`,
            $source: `plugin:${app.plugin.id}`
        };
        delta.addMeta(module.switchbankPath, metadata);
        Object.keys(module.channels).forEach((key) => {
            let metadata = {
                description: module.channels[key].description || `Channel ${key}`,
                index: module.channels[key].id,
                shortName: `[${module.id},${module.channels[key].id}]`,
                longName: `[${module.id},${module.channels[key].id}]`,
                displayName: module.channels[key].description || `[${module.id},${module.channels[key].id}]`,
                unit: 'Binary switch state (0/1)',
                type: module.channels[key].type,
                $source: `plugin:${app.plugin.id}`
            };
            delta.addMeta(module.channels[key].path, metadata);
        });
        delta.commit().clear();
    }
    function openCommandConnection(module) {
        app.debug(`openCommandConnection(${module})...`);
        if ((module.ipAddress) && (module.commandPort)) {
            module.commandConnection = net.createConnection(module.commandPort, module.ipAddress);
            module.commandConnection.on('open', (socket) => {
                app.debug(`command connection to ${module.ipAddress}:${module.commandPort} is open`);
                module.commandConnection = socket;
                module.commandQueue = [];
                module.currentCommand = undefined;
            });
            module.commandConnection.on('close', () => {
                app.debug(`command connection to ${module.ipAddress}:${module.commandPort} has closed`);
                module.commandConnection.destroy();
                module.commandConnection = undefined;
                module.commandQueue = [];
                module.currentCommand = undefined;
            });
            module.commandConnection.on('data', (data) => {
                if (data.toString().trim() == 'Ok') {
                    if (module.currentCommand) {
                        module.currentCommand.callback({ state: 'COMPLETED', statusCode: 200 });
                        module.currentCommand = undefined;
                    }
                    else {
                        app.debug(`orphan command response received from module ${module.ipAddress}`);
                    }
                }
            });
        }
    }
    function processCommandQueues() {
        Object.keys(appState.modules).forEach(key => processCommandQueue(appState.modules[key]));
        function processCommandQueue(module) {
            if ((module.commandConnection) && (module.currentCommand == null) && (module.commandQueue) && (module.commandQueue.length > 0)) {
                module.currentCommand = module.commandQueue.shift();
                if ((module.commandConnection) && (module.currentCommand)) {
                    module.commandConnection.write(`${module.currentCommand.command}\n`);
                    app.setPluginStatus(`sending '${module.currentCommand.command}' to module '${module.ipAddress}'`);
                }
                else {
                    app.setPluginError(`cannot send command to module '${module.ipAddress}' (no connection)`);
                }
            }
        }
    }
    function getChannelDescription(channels, channelId) {
        return (channels.reduce((a, m) => ((m.id == channelId) ? m.description : a), `Channel ${channelId}`));
    }
    function getRelayCount(module) {
        var retval = 0;
        Object.keys(module.channels).forEach((key) => {
            if (module.channels[key].type == 'relay')
                retval++;
        });
        return (retval);
    }
    function getSwitchCount(module) {
        var retval = 0;
        Object.keys(module.channels).forEach((key) => {
            if (module.channels[key].type == 'switch')
                retval++;
        });
        return (retval);
    }
    function getChannelOnCommand(device, channelIndex) {
        var retval = '';
        if ((device.channels[0].address == 0) && (device.channels.length == 1)) {
            retval = device.channels[0].oncommand;
        }
        else {
            retval = device.channels.reduce((a, c) => ((c.address == channelIndex) ? c.oncommand : a), undefined);
        }
        retval = retval.replace('{c}', `${channelIndex}`);
        return (retval);
    }
    function getChannelOffCommand(device, channelIndex) {
        var retval = '';
        if ((device.channels[0].address == 0) && (device.channels.length == 1)) {
            retval = device.channels[0].offcommand;
        }
        else {
            retval = device.channels.reduce((a, c) => ((c.address == channelIndex) ? c.offcommand : a), undefined);
        }
        retval = retval.replace('{c}', `${channelIndex}`);
        return (retval);
    }
    function relayPutHandler(context, path, value, callback) {
        app.debug(`relayPutHandler(${context},${path},${value})`);
        var module, channel, relayCommand;
        var retval = { state: 'COMPLETED', statusCode: 400 };
        module = appState.modules[getModuleIdFromPath(path)];
        if (module) {
            if (module.commandConnection) {
                channel = module.channels[getChannelIndexFromPath(path)];
                if (channel) {
                    let relayCommand = ((value) ? channel.onCommand : channel.offCommand);
                    if (relayCommand)
                        module.commandQueue.push({ command: relayCommand, callback: callback });
                    retval = { state: 'PENDING' };
                }
            }
            else {
                app.debug(`PUT request cannot be actioned (module '${module.ipAddress}' has no open command connection)`);
            }
        }
        return (retval);
        function getModuleIdFromPath(path) {
            var parts = path.split('.');
            return ((parts.length >= 4) ? parts[3] : '');
        }
        function getChannelIndexFromPath(path) {
            var parts = path.split('.');
            return ((parts.length >= 5) ? parts[4] : '');
        }
    }
    function ipAddress2moduleId(ipAddress) {
        return ((0, sprintf_js_1.sprintf)('%03d%03d%03d%03d', ipAddress.split('.')[0], ipAddress.split('.')[1], ipAddress.split('.')[2], ipAddress.split('.')[3]));
    }
    function moduleId2ipAddress(moduleId) {
        return ((0, sprintf_js_1.sprintf)('%d\.%d\.%d\.%d', +(moduleId.slice(0, 3)), +(moduleId.slice(3, 6)), +(moduleId.slice(6, 9)), +(moduleId.slice(9))));
    }
    return (plugin);
}; // End of app
