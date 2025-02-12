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

import * as net from 'net'
import { sprintf } from 'sprintf-js'
import { Request, Response } from 'express'
import { Delta } from 'signalk-libdelta'

const PLUGIN_ID: string = 'devantech'
const PLUGIN_NAME: string = 'pdjr-skplugin-devantech'
const PLUGIN_DESCRIPTION: string = 'Signal K interface to the Devantech DS range of general-purpose relay modules'
const PLUGIN_SCHEMA: any = {
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
    "modules" : {
      "title": "Module configurations",
      "type": "array",
      "items": {
        "type": "object",
        "required": [ "ipAddress", "description", "channels" ],
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
                "id": {
                  "title": "Channel identifier",
                  "description": "Signal K channel identifier to which this configuration applies.",
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
        "required" : [ "id", "channels" ],
        "properties": {
          "id": {
            "title": "Device identifier",
            "type": "string"
          },
          "numberOfRelays": {
            "title": "Number of supported relay channels",
            "type": "number"
          },
          "numberOfSwitches": {
            "title": "Number of supported switch channels",
            "type": "number"
          },
          "channels" : {
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
        "numberOfRelays": 32,
        "numberOfSwitches": 8,
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
        "numberOfRelays": 24,
        "numberOfSwitches": 8,
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
}
const PLUGIN_UISCHEMA: any = {}

const DEFAULT_STATUS_LISTENER_PORT = 28241
const DEFAULT_CLIENT_IP_FILTER = '.*'
const DEFAULT_TRANSMIT_QUEUE_HEARTBEAT = 25
const DEFAULT_COMMAND_PORT = 17123
const DEFAULT_DEVICE_ID = 'DS'

const FETCH_RESPONSES: { [index: number] : string } = {
  200: "OK",
  201: "Created",
  207: "Multi-Status",
  400: "Bad Request",
  404: "Not Found",
  503: "Service Unavailable",
  500: "Internal Server Error"
};

module.exports = function(app: any) {

  var appOptions: any = undefined;

  var appState: State = {
    clientFilterRegExp: undefined,
    statusListener: undefined,
    transmitQueueTimer: undefined,
    modules: []
  }

  const plugin: SKPlugin = {
   
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: PLUGIN_DESCRIPTION,
    schema: PLUGIN_SCHEMA,
    uiSchema: PLUGIN_UISCHEMA,

    start: function(options: any) {
      console.log("Starting...");
      appOptions = options;

      try {
        let statusListenerPort = (appOptions.statusListenerPort)?appOptions.statusListenerPort:DEFAULT_STATUS_LISTENER_PORT;
        appState.statusListener = startStatusListener(statusListenerPort);
        try {
          appState.clientFilterRegExp = new RegExp((appOptions.clientIpFilter)?appOptions.clientIpFilter:DEFAULT_CLIENT_IP_FILTER);
          appState.transmitQueueTimer = setInterval(() => { processCommandQueues() }, ((appOptions.transmitQueueHeartbeat)?appOptions.transmitQueueHeartbeat:DEFAULT_TRANSMIT_QUEUE_HEARTBEAT));
          appState.modules = {}  
          app.setPluginStatus(`Started: listening for DS module connections on port ${statusListenerPort}`);
        } catch (e: any) {
          app.setPluginStatus('Stopped: error starting transmit queue processor');
          app.debug(`error starting transmit queue processor: ${e.message}`);
          appState.statusListener.close();
        }
      } catch (e: any) {
        app.setPluginStatus('Stopped: error starting connection listener');
        app.debug(`error starting connection listener: ${e.message}`);
      }
    },

    stop: function() {
      Object.keys(appState.modules).forEach((key: string) => {
        if (appState.modules[key].listenerConnection) appState.modules[key].listenerConnection.destroy();
        if (appState.modules[key].commandConnection) appState.modules.commandConnection.destroy();
      });
      if (appState.statusListener) appState.statusListener.close();
      clearTimeout(appState.transmitQueueTimer);
    },

    registerWithRouter: function(router: any) {
      router.get('/status', handleRoutes);
    },
    
    getOpenApi: function() {
      return(require("./openApi.json"));
    }

  } // End of plugin
  
  function handleRoutes(req: Request, res: Response) {
    app.debug(`processing ${req.method} request on '${req.path}`);
    try {
      switch (req.path.slice(0, (req.path.indexOf('/', 1) == -1)?undefined:req.path.indexOf('/', 1))) {
        case '/status':
          const body: any = Object.keys(appState.modules).reduce((a: any, id: string) => {
            a[id] = {
              description: appState.modules[id].description,
              deviceId: appState.modules[id].deviceId,
              ipAddress: appState.modules[id].ipAddress,
              commandPort: appState.modules[id].commandPort,
              commandConnection: (appState.modules[id].commandConnection)?'open':'closed',
              switchbankPath: appState.modules[id].switchbankPath
            };
            return(a);
          }, {});
          expressSend(res, 200, body, req.path);
          break;
      }
    } catch(e: any) {
      app.debug(e.message)
      expressSend(res, ((/^\d+$/.test(e.message))?parseInt(e.message):500), null, req.path)
    }
  
    function expressSend(res: Response, code: number, body: string | null = null, debugPrefix: string | null = null) {
      app.debug(`expressSend():`);
      res.status(code).send((body)?body:((FETCH_RESPONSES[code])?FETCH_RESPONSES[code]:null));
      if (debugPrefix) app.debug("%s: %d %s", debugPrefix, code, ((body)?JSON.stringify(body):((FETCH_RESPONSES[code])?FETCH_RESPONSES[code]:null)));
      return(false);
    }
  }

  function startStatusListener(port: number) {
    app.debug(`startStatusListener(${port}):`);
    var retval: net.Server = net.createServer().listen(port);
    retval.on('connection', (client: net.Socket) => {
      var module: Module;
      if (client.remoteAddress) {
        var clientIp: string = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
        if ((appState.clientFilterRegExp) && (appState.clientFilterRegExp.test(clientIp))) {
          app.setPluginStatus(`Accepting connection from ${clientIp}`);
          module = getModule(clientIp);          
          if (module.listenerConnection) module.listenerConnection.destroy();
          module.listenerConnection = client;
          if ((module.commandPort) && (!module.commandConnection)) openCommandConnection(module);
  
          client.on('data', (data: any) => {
            app.debug(`receiving data from ${module.ipAddress}`);
            try {
              const messageLines: string[] = data.toString().split('\n');
              const relayStates: string = messageLines[1].trim();
              const switchStates: string = messageLines[2].replaceAll(' ','').trim();
        
              var delta: Delta = new Delta(app, plugin.id);
              for (var i: number = 0; i < relayStates.length; i++) {
                var channel: Channel = module.channels[`${i+1}r`];
                if (channel) {
                  delta.addValue(`${channel.path}.order`, channel.index);
                  delta.addValue(`${channel.path}.state`, ((relayStates.charAt(i) == '0')?0:1));
                }
              }
              for (var i: number = 0; i < switchStates.length; i++) {
                var channel: Channel = module.channels[`${i+1}s`];
                if (channel) {
                  delta.addValue(`${channel.path}.order`, channel.index);
                  delta.addValue(`${channel.path}.state`, ((switchStates.charAt(i) == '0')?0:1));
                }
              }
              delta.commit().clear();
            } catch(e: any) {
              app.debug(`error processing data from ${clientIp} (${e.message})`);
            }
          });
  
          client.on('close', () => {
            app.debug(`closing client connection`);
            if (client.remoteAddress) {
              var module = appState.modules[ipAddress2moduleId(client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1))];
              if (module) {
                app.debug(`status listener: closing connection for ${module.ipAddress}`)
                module.listenerConnection.destroy();
                module.listenerConnection = undefined;
              }
            }
          });

        } else {
          app.setPluginError(`Rejecting connection attempt from ${clientIp}`);
          client.destroy();
        }
      }
    });
    return(retval);
  }

  function getModule(ipAddress: string): Module {
    var module: Module;

    if (ipAddress2moduleId(ipAddress) in appState.modules) {
      return(appState.modules[ipAddress2moduleId(ipAddress)]);
    } else {
      app.debug(`creating new module for ${ipAddress}`);
      var moduleOptions: any = appOptions.modules.reduce((a: any, m: any) => (((m.ipAddress) && (m.ipAddress == ipAddress))?m:a), {});
      module = {
        id: ipAddress2moduleId(ipAddress),
        deviceId: (moduleOptions.deviceId || appOptions.defaultDeviceId || DEFAULT_DEVICE_ID),
        description: (moduleOptions.description || `Devantech DS switchbank at '${ipAddress}'`),
        ipAddress: ipAddress,
        switchbankPath: `electrical.switches.bank.${ipAddress2moduleId(ipAddress)}`,
        commandPort: (moduleOptions.commandPort || appOptions.defaultCommandPort || DEFAULT_COMMAND_PORT),
        commandConnection: null,
        commandQueue: [],
        currentCommand: undefined,
        listenerConnection: null,
        channels: {}
      };
      // To configure the channels array we need to get the
      // device details which relate to this module.
      var device = appOptions.devices.reduce((a: any, d: any) => { return((d.id == module.deviceId)?d:a); }, undefined);
      if ((device) && (device.numberOfRelays) && (device.numberOfSwitches)) {
        for (var i: number = 0; i < device.numberOfRelays; i++) {
          var channelId: string = `${i+1}r`;
          var channelOptions: any = moduleOptions.channels.reduce((a: any, c: any) => ((c.id == channelId)?c:a), undefined);
          var channel: Channel = {
            id: channelId,
            type: 'relay',
            description: ((channelOptions) && (channelOptions.description))?channelOptions.description:`Channel ${channelId} on module ${module.id}`,
            path: `${module.switchbankPath}.${channelId}`,
            index: (i + 1),
            onCommand: getChannelOnCommand(device, (i + 1)),
            offCommand: getChannelOffCommand(device, (i + 1))
          }
          module.channels[channelId] = channel;

          app.registerPutHandler('vessels.self', channel.path, relayPutHandler);
        };
        for (var i: number = 0; i < device.numberOfSwitches; i++) {
          var channelId: string = `${i+1}s`;
          var channelOptions: any = moduleOptions.channels.reduce((a: any, c: any) => ((c.id == channelId)?c:a), undefined);
          var channel: Channel = {
            id: channelId,
            type: 'switch',
            description: ((channelOptions) && (channelOptions.description))?channelOptions.description:`Channel ${channelId} on module ${module.id}`,
            path: `${module.switchbankPath}.${channelId}`,
            index: (i + 1)
          }
          module.channels[channelId] = channel;
        };
        publishModuleMetadata(module);
        appState.modules[module.id] = module;
        return(module);
      } else {
        throw new Error('bad device specification');
      }
    }
  }
  
  function publishModuleMetadata(module: Module): void {
    app.debug(`publishModuleMetadata(): for ${module.ipAddress}`);
    var delta = new Delta(app, plugin.id);
    let metadata = {
      description: module.description,
      instance: module.id,
      device: module.deviceId,
      shortName: module.id,
      longName: `Module ${module.id}`,
      displayName: `Module ${module.id}`,
      $source: `plugin:${plugin.id}`
    };
    delta.addMeta(module.switchbankPath, metadata);  
    Object.keys(module.channels).forEach((key: string) => {
      let metadata = {
        description: module.channels[key].description || `Channel ${key}`,
        index: module.channels[key].id,
        shortName: `[${module.id},${module.channels[key].id}]`,
        longName: `[${module.id},${module.channels[key].id}]`,
        displayName: module.channels[key].description || `[${module.id},${module.channels[key].id}]`,
        unit: 'Binary switch state (0/1)',
        type: module.channels[key].type,
        $source: `plugin:${plugin.id}`
      }
      delta.addMeta(module.channels[key].path + '.state', metadata);  
    })
    delta.commit().clear()
  }
  
  function openCommandConnection(module: Module) {
    app.debug(`openCommandConnection(${module})...`);
  
    if ((module.ipAddress) && (module.commandPort)) {
  
      module.commandConnection = net.createConnection(module.commandPort, module.ipAddress);
      
      module.commandConnection.on('open', (socket: net.Socket) => {
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
  
      module.commandConnection.on('data', (data: any) => {
        if (data.toString().trim() == 'Ok') {
          if (module.currentCommand) {
            module.currentCommand.callback({ state: 'COMPLETED', statusCode: 200 });
            module.currentCommand = undefined;
          } else {
            app.debug(`orphan command response received from module ${module.ipAddress}`);
          }
        }
      });
    }
  }

  function processCommandQueues() {
    Object.keys(appState.modules).forEach(key => processCommandQueue(appState.modules[key]));
  
    function processCommandQueue(module: Module) {
      if ((module.commandConnection) && (module.currentCommand == null) && (module.commandQueue) && (module.commandQueue.length > 0)) {
        module.currentCommand = module.commandQueue.shift();
        if ((module.commandConnection) && (module.currentCommand)) {
          module.commandConnection.write(`${module.currentCommand.command}\n`);
          app.setPluginStatus(`sending '${module.currentCommand.command}' to module '${module.ipAddress}'`);
        } else {
          app.setPluginError(`cannot send command to module '${module.ipAddress}' (no connection)`);
        }
      }
    }
  }
  
  function getChannelDescription(channels: any, channelId: string) {
    return(channels.reduce((a: string, m: any) => ((m.id == channelId)?m.description:a), `Channel ${channelId}`));
  }
  
  function getRelayCount(module: Module): number {
    var retval: number = 0;
    Object.keys(module.channels).forEach((key: string) => {
      if (module.channels[key].type == 'relay') retval++;
    })
    return(retval);
  }
  
  function getSwitchCount(module: Module): number {
    var retval: number = 0;
    Object.keys(module.channels).forEach((key: string) => {
      if (module.channels[key].type == 'switch') retval++;
    })
    return(retval);
  }
  
  function getChannelOnCommand(device: any, channelIndex: number): string {
    var retval: string = '';
    if ((device.channels[0].address == 0) && (device.channels.length == 1)) {
      retval = device.channels[0].oncommand;
    } else {
      retval = device.channels.reduce((a: string | undefined, c: any) => ((c.address == channelIndex)?c.oncommand:a)
      , undefined);
    }
    retval = retval.replace('{c}', `${channelIndex}`);
    return(retval)
  }
  
  function getChannelOffCommand(device: any, channelIndex: number): string {
    var retval: string = '';
    if ((device.channels[0].address == 0) && (device.channels.length == 1)) {
      retval = device.channels[0].offcommand;
    } else {
      retval = device.channels.reduce((a: string | undefined, c: any) => ((c.address == channelIndex)?c.offcommand:a), undefined);
    }
    retval = retval.replace('{c}', `${channelIndex}`);
    return(retval)
  }
  
  function relayPutHandler(context: any, path: string, value: number, callback: any) {
    app.debug(`relayPutHandler(${context},${path},${value})`);
    var module: Module, channel: Channel, relayCommand: string;
    var retval: { state: string, statusCode?: number } = { state: 'COMPLETED', statusCode: 400 };
  
    module = appState.modules[getModuleIdFromPath(path)]
    if (module) {
      if (module.commandConnection) {
        channel = module.channels[getChannelIndexFromPath(path)];
        if (channel) {
          let relayCommand = ((value)?channel.onCommand:channel.offCommand);
          if (relayCommand) module.commandQueue.push({ command: relayCommand, callback: callback });
          retval = { state: 'PENDING' };
        }
      } else {
        app.debug(`PUT request cannot be actioned (module '${module.ipAddress}' has no open command connection)`);
      }
    }
    return(retval);
  
    function getModuleIdFromPath(path: string): string {
      var parts = path.split('.');
      return((parts.length >= 4)?parts[3]:'');
    }
    
    function getChannelIndexFromPath(path: string): string {
      var parts = path.split('.');
      return((parts.length >= 5)?parts[4]:'');
    }    
  }
  
  function ipAddress2moduleId(ipAddress: string): string {
    return(sprintf('%03d%03d%03d%03d', ipAddress.split('.')[0], ipAddress.split('.')[1], ipAddress.split('.')[2], ipAddress.split('.')[3]));
  }
  
  function moduleId2ipAddress(moduleId: string): string {
    return(sprintf('%d\.%d\.%d\.%d', +(moduleId.slice(0,3)), +(moduleId.slice(3,6)), +(moduleId.slice(6,9)), +(moduleId.slice(9))));
  }

  return(plugin);

} // End of app

interface SKPlugin {
  id: string,
  name: string,
  description: string,
  schema: any,
  uiSchema: any,
  start: (options: any) => void,
  stop: () => void,
  registerWithRouter: (router: any) => void,
  getOpenApi: () => () => string
}

interface Channel {
  id: string,
  type: string,
  description: string,
  path: string,
  index: number,
  onCommand?: string,
  offCommand?: string
}

interface Module {
  id: string,
  ipAddress: string,
  description: string,
  deviceId: string | undefined,
  switchbankPath: string,
  commandPort: number,
  commandConnection: any,
  commandQueue: { command: string, callback: any }[],
  currentCommand: { command: string, callback: any } | undefined,
  listenerConnection: any,
  channels: { [index: string]: Channel }
}

interface State {
  clientFilterRegExp: RegExp | undefined,
  statusListener: net.Server | undefined,
  transmitQueueTimer: NodeJS.Timeout | undefined,
  modules: { [index: string]: any }
}

