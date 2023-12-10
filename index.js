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

const net = require('net');
const _ = require('lodash');
const sprintf = require('sprintf-js').sprintf;
const { networkInterfaces } = require('os');

const Delta = require('signalk-libdelta/Delta.js');
const HttpInterface = require('signalk-libhttpinterface/HttpInterface.js');
const Log = require('signalk-liblog/Log.js');

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
    "modules" : {
      "title": "Module configurations",
      "type": "array",
      "items": {
        "type": "object",
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
        "required" : [ "id", "channels" ],
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

module.exports = function(app) {
  var plugin = {};

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;
  plugin.schema = PLUGIN_SCHEMA;
  plugin.uiSchema = PLUGIN_UISCHEMA;

  const log = new Log(plugin.id, { ncallback: app.setPluginStatus, ecallback: app.setPluginError });
  const httpInterface = new HttpInterface(app.getSelfPath('uuid'));

  var statusListener = null;
  var transmitQueueTimer = null;

  plugin.start = function(options) {
    plugin.options = _.cloneDeep(plugin.schema.default);
    _.merge(plugin.options, options);
    plugin.options.activeModules = {};

    app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`);

    try {
      plugin.options.clientIpFilterRegex = (plugin.options.clientIpFilter)?(new RegExp(plugin.options.clientIpFilter)):httpInterface.getPrivateAddressRegExp(httpInterface.getHostIpAddress());
      log.N(`listening for DS module connections on ${httpInterface.getHostIpAddress()}:${plugin.options.statusListenerPort || plugin.schema.properties.statusListenerPort.default}`);
      startStatusListener(plugin.options.statusListenerPort || plugin.schema.properties.statusListenerPort.default);
      transmitQueueTimer = setInterval(processCommandQueues, plugin.options.transmitQueueHeartbeat || plugin.schema.properties.transmitQueueHeartbeat);
    } catch(e) {
      log.E(`stopped: ${e.message}`);
    }
  }

  plugin.stop = function() {
    plugin.options.modules.forEach(module => {
      if (module.listenerConnection) module.listenerConnection.destroy();
      if (module.commandConnection) module.commandConnection.destroy();
    });
    if (statusListener) statusListener.close();
    clearTimeout(transmitQueueTimer);
  }

  plugin.registerWithRouter = function(router) {
    router.get('/status', (req,res) => handleExpress(req, res, expressGetStatus));
  }

  plugin.getOpenApi = () => require("./resources/openApi.json");

  /********************************************************************
   * Return the host's Version 4 IP address, disregarding the localhost
   * address or throw and exception if the address cannot be retrieved.
   */
  function getHostIpAddress() {
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
        if ((net.family === familyV4Value) && (!net.internal)) return(net.address);
      }
    }
    throw new Error("could not get host IP address");
  }

  /********************************************************************
   * Get a RegExp object that can be used to filter IP addresses to
   * ensure that they fall within the same private subnet as
   * <ipAddress> or throw an exception. 
   */
  function getPrivateAddressRegExp(ipAddress) {
    var parts = ipAddress.split('.').map(n => parseInt(n));
    if (parts.length != 4) throw new Error("invalid IP address");
    if ((parts[0] == 192) && (parts[1] == 168)) return(new RegExp('^192\\.168\\.\\d+\\.\\d+$'));
    if ((parts[0] == 172) && (parts[1] >= 16) && (parts[1] <= 31)) return(new RegExp('^172\\.16\\.(16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31)\\.\\d+\\.\\d+$'));
    if (parts[0] == 10) return(new RegExp('^10\\.\\d+\\.\\d+\\.\\d+$'));
    throw new Error("IP address is public");
  }

  /********************************************************************
   * If the plugin.options.activeModules dictionary does not contain a
   * property for ipAddress then:
   * 
   * 1. Create a new object in plugin.options.activeModules that
   *    captures the configuration and operating state of the module.
   * 2. Create a Signal K path for the module under
   *    electrical.switches.bank.
   * 3. Create a metadata entry for the new path.
   * 
   * Returns the newly created or already existing property identified
   * by ipAddress.
   * 
   * @param {*} ipAddress - the module to be created. 
   * @returns - the active module identified by ipAddress.
   */
  function createActiveModule(ipAddress) {
    const moduleId = sprintf('%03d%03d%03d%03d', ipAddress.split('.')[0], ipAddress.split('.')[1], ipAddress.split('.')[2], ipAddress.split('.')[3]);
    if (!plugin.options.activeModules[moduleId]) {
      app.debug(`creating new module '${moduleId}'`);
      var module = (plugin.options.modules || []).reduce((a,m) => { return((m.ipAddress == ipAddress)?m:a ); }, {});
      var retval = {
        ipAddress: ipAddress,
        commandPort: module.commandPort || (plugin.options.defaultCommandPort || plugin.schema.properties.defaultCommandPort.default),
        description: module.description || `Devantech DS switchbank at '${ipAddress}'`,
        id: moduleId,
        switchbankPath: `electrical.switches.bank.${moduleId}`,
        commandConnection: null,
        commandQueue: [],
        currentCommand: null,
        deviceId: module.deviceId || (plugin.options.defaultDeviceId || plugin.schema.properties.defaultDeviceId.default),
        channels: {}
      };
      retval.device = plugin.options.devices.reduce((a,d) => { return((d.id == retval.deviceId)?d:a); }, undefined);
      if (!retval.device) throw new Error(`device '${retval.deviceId}' is not configured`);
      plugin.options.activeModules[moduleId] = retval;
      const metadata = {
        description: retval.description,
        instance: retval.id,
        device: retval.device.id,
        shortName: retval.id,
        longName: `Module ${retval.id}`,
        displayName: `Module ${retval.id}`,
        $source: `plugin:${plugin.id}`
      };
      (new Delta(app, plugin.id)).addMeta(retval.switchbankPath, metadata).commit().clear();  
    }
    return(plugin.options.activeModules[moduleId]);
  }

  /********************************************************************
   * If the channels dictionary in activeModule is empty, then create
   * properties for the specified number of relay and switch channels
   * by:
   * 
   * 1. Creating objects in activeModule.channels which capture the
   *    configuration and operating state of each channel.
   * 2. Creating a Signal K path for each created channel under the
   *    switchbank path associated with activeModule.
   * 3. Create a metadata entry for each new path.
   * 4. Install a PUT handler on each relay path.
   *
   * @param {*} activeModule
   * 
   */
  function createActiveChannels(activeModule, relayChannelCount, switchChannelCount) {
    if (Object.keys(activeModule.channels).length == 0) {
      app.debug(`createActiveChannels(${activeModule.id})...`);
      var module, channel, index, metadata, delta = new Delta(app, plugin.id);
      module = (plugin.options.modules || []).reduce((a,m) => { return((m.ipAddress == activeModule.ipAddress)?m:a); },  { channels: [] });
      for (var i = 0; i < relayChannelCount; i++) {
        index = `${i+1}R`;
        channel = module.channels.reduce((a,c) => { return((c.index == index)?c:a); }, {});
        activeModule.channels[index] = {
          index: index,
          type: 'relay',
          description: channel.description || `Channel ${index}`,
          path: `${activeModule.switchbankPath}.${index}.state`
        };
        if ((activeModule.device.channels[0].address == 0) && (activeModule.device.channels.length == 1)) {
          activeModule.channels[index].oncommand = activeModule.device.channels[0].oncommand;
          activeModule.channels[index].offcommand = activeModule.device.channels[0].offcommand;
        } else {
          activeModule.channels[index].oncommand = activeModule.device.channels.reduce((a,c) => ((c.address == parseInt(index))?c.oncommand:a), null);
          activeModule.channels[index].offcommand = activeModule.device.channels.reduce((a,c) => ((c.address == parseInt(index))?c.offcommand:a), null);
        }
        activeModule.channels[index].oncommand = activeModule.channels[index].oncommand.replace('{c}', parseInt(index));
        activeModule.channels[index].offcommand = activeModule.channels[index].offcommand.replace('{c}', parseInt(index));
       
        metadata = {
          description: channel.description || `Channel ${index}`,
          index: index,
          shortName: `[${activeModule.id},${index}]`,
          longName: `[${activeModule.id},${index}]`,
          displayName: channel.description || `[${activeModule.id},${index}]`,
          unit: 'Binary switch state (0/1)',
          type: 'relay',
          $source: `plugin:${plugin.id}`
        };
        delta.addMeta(activeModule.channels[index].path, metadata);
        delta.addValue(activeModule.channels[index].path.replace('state','order'), parseInt(index));
        app.registerPutHandler('vessels.self', activeModule.channels[index].path, relayPutHandler, plugin.id);
      }

      for (var i = 0; i < switchChannelCount; i++) {
        index = `${i+1}S`;
        channel = module.channels.reduce((a,c) => { return((c.index == index)?c:a); }, {});
        activeModule.channels[index] = {
          index: index,
          type: 'relay',
          description: channel.description || `Channel ${index}`,
          path: `${activeModule.switchbankPath}.${index}.state`
        };

        metadata = {
          description: channel.description || `Channel ${index}`,
          index: index,
          shortName: `[${activeModule.id},${index}]`,
          longName: `[${activeModule.id},${index}]`,
          displayName: channel.description || `[${activeModule.id},${index}]`,
          unit: 'Binary switch state (0/1)',
          type: 'switch',
          $source: `plugin:${plugin.id}`
        };
        delta.addMeta(activeModule.channels[index].path, metadata);
        delta.addValue(activeModule.channels[index].path.replace('state','order'), parseInt(index));
      }
      delta.commit().clear();
    }
  }

  /********************************************************************
   * Connects module to the TCP command connection specified by
   * module.cobject, setting module.commandConnection to the new
   * connection stream and arranging for subsequent processing.
   * 
   * @param {*} module - the module to be connected.
   */
  function openCommandConnection(module) {
    app.debug(`openCommandConnection(${module})...`);

    if (!module.ipAddress) throw new Error("cannot open command connection (missing 'ipAddress')");
    if (!module.commandPort) throw new Error("cannot open command connectione (missing 'commandPort')");

    module.commandConnection = net.createConnection(module.commandPort, module.ipAddress);
    
    module.commandConnection.on('open', (socket) => {
      app.debug(`command connection to ${module.ipAddress}:${module.commandPort} is open`);
      module.commandConnection = socket;
      module.commandQueue = [];
      module.currentCommand = null;
    });

    module.commandConnection.on('close', () => {
      app.debug(`command connection to ${module.ipAddress}:${module.commandPort} has closed`);
      module.commandConnection.destroy();
      module.commandConnection = null;
      module.commandQueue = [];
      module.currentCommand = null;
    });

    module.commandConnection.on('data', (data) => {
      if (data.toString().trim() == 'Ok') {
        if (module.currentCommand) {
          module.currentCommand.callback({ state: 'COMPLETED', statusCode: 200 });
          module.currentCommand = null;
        } else {
          app.debug(`orphan command response received from module ${module.ipAddress}`);
        }
      }
    });
  }

  /********************************************************************
   * Open an event notification listener on the specified port.
   * 
   * DS modules create a new connection for every event notification,
   * so things on the receive side get a little busy in a way which is
   * out of our control.
   * 
   * When a valid module connects a new command connection is made if
   * one does not already exist and this is preserved indefinitely
   * across the shenanigans of event notification client connection
   * dynamics.
   *  
   * @param {*} port - the port on which to listen for DS device client
   *                   connections.
   */
  function startStatusListener(port) {
    app.debug(`startStatusListener(${port})...`);

    statusListener = net.createServer((client) => {

      /**
       * Extracts relay and digital input state information from <data>
       * and updates configured Signal K relay and switchbanks.
       */
      client.on('data', (data) => {
        try {
          var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
          const moduleId = sprintf('%03d%03d%03d%03d', clientIP.split('.')[0], clientIP.split('.')[1], clientIP.split('.')[2], clientIP.split('.')[3]);
          var module = plugin.options.activeModules[moduleId];
          if (module) {
            createActiveChannels(module, (module.device.relays || relayStates.length), (module.device.switches || switchStates.length));
            const messageLines = data.toString().split('\n');
            const relayStates = messageLines[1].trim();
            const switchStates = messageLines[2].replaceAll(' ','').trim();
            app.debug(`status listener: received status: ${relayStates} ${switchStates}`);
            var delta = new Delta(app, plugin.id);
            for (var i = 0; i < ((module.device.relays)?module.device.relays:relayStates.length); i++) {
              delta.addValue(`${module.switchbankPath}.${i+1}R.order`, (i+1));
              delta.addValue(`${module.switchbankPath}.${i+1}R.state`, ((relayStates.charAt(i) == '0')?0:1));
            }
            for (var i = 0; i < ((module.device.switches)?module.device.switches:switchStates.length); i++) {
              delta.addValue(`${module.switchbankPath}.${i+1}S.order`, (i+1));
              delta.addValue(`${module.switchbankPath}.${i+1}S.state`, ((switchStates.charAt(i) == '0')?0:1));
            }
            delta.commit().clear();
            delete delta;
          } else throw new Error(`status received from ${clientIP}`);
        } catch(e) {
          app.debug(e.message);
        }
      });

      /**
       * Closes the client connection. Not a problem since the remote
       * device will recreate it the next time it needs to transmit a
       * status report.
       */
      client.on('close', () => {
        var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
        const moduleId = sprintf('%03d%03d%03d%03d', clientIP.split('.')[0], clientIP.split('.')[1], clientIP.split('.')[2], clientIP.split('.')[3]);
        var module = plugin.options.activeModules[moduleId];
        if (module) {
          app.debug(`status listener: closing connection for ${clientIP}`)
          module.listenerConnection.destroy();
          module.listenerConnection = null;
        }
      });

      /**
       * Only allow connections from configured modules.
       */
      var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
      try {
        if (!plugin.options.clientIpFilterRegex.test(clientIP)) throw new Error(`unauthorised device at ${clientIP}`);
      
        var module = createActiveModule(clientIP);

        app.debug(`status listener: opening listener connection '${clientIP}'`);
        if (module.listenerConnection) module.listenerConnection.destroy();
        module.listenerConnection = client;
        
        if ((module.commandPort) && (!module.commandConnection)) {
          app.debug(`status listener: opening command connection '${clientIP}'`);
          openCommandConnection(module);
        }
      } catch(e) {
        log.W(`status listener: rejecting connection (${e.message})`, false);
        client.destroy();
      }
    });
    
    statusListener.listen(port, () => { app.debug(`status listener: listening on port ${port}`); });
  }

  /********************************************************************
   * Iterates over every module sending any available message in each
   * module's commandQueue.
   */
  function processCommandQueues() {
    Object.keys(plugin.options.activeModules).forEach(key => processCommandQueue(plugin.options.activeModules[key]));

    function processCommandQueue(module) {
      if ((module.commandConnection) && (module.currentCommand == null) && (module.commandQueue) && (module.commandQueue.length > 0)) {
        module.currentCommand = module.commandQueue.shift();
        if (module.commandConnection) {
          module.commandConnection.write(`${module.currentCommand.command}\n`);
          log.N(`sending '${module.currentCommand.command}' to module '${module.ipAddress}'`);
        } else {
          log.E(`cannot send command to module '${module.ipAddress}' (no connection)`);
        }
      }
    }

  }

  /********************************************************************
   * Handler function triggered by a PUT request on a switch path.
   * 
   * The function recovers a command string dictated by path and value
   * and places this and the passed callback into the module's command
   * queue returning a PENDING response to Signal K.
   * 
   * The PUT handling process will resolve when processCommandQueues() 
   * actually transmits the command to the target device and the device
   * confirms action.
   * 
   * @param {*} context - not used. 
   * @param {*} path - path of the switch to be updated.
   * @param {*} value - requested state (0 or 1).
   * @param {*} callback - saved for use by processCommandQueues().
   * @returns PENDING on success, COMPLETED/400 on error.
   */
  function relayPutHandler(context, path, value, callback) {
    app.debug(`relayPutHandler(${context},${path},${value})`);
    var moduleId, module, channelIndex, channel, relayCommand;
    var retval = { state: 'COMPLETED', statusCode: 400 };
    var module = plugin.options.activeModules[getModuleIdFromPath(path)];
    if (module) {
      if (module.commandConnection) {
        var channel = module.channels[getChannelIndexFromPath(path)];
        if (channel) {
          relayCommand = ((value)?channel.oncommand:channel.offcommand);
          module.commandQueue.push({ command: relayCommand, callback: callback });
          retval = { state: 'PENDING' };
        }
      } else {
        app.debug(`PUT request cannot be actioned (module '${module.ipAddress}' has no open command connection)`);
      }
    }
    return(retval);

    function getModuleIdFromPath(path) {
      var parts = path.split('.');
      return((parts.length >= 4)?parts[3]:null);
    }
  
    function getChannelIndexFromPath(path) {
      var parts = path.split('.');
      return((parts.length >= 5)?parts[4]:null);
    }    
  }

  /********************************************************************
   * Express handlers...
   */

  handleExpress = function(req, res, handler) {
    app.debug(`processing ${req.method} request on '${req.path}`);
    handler(req, res);
  }

  expressGetStatus = function(req, res) {
    const body = plugin.options.activeModules.reduce((a,module) => {
      a[module.id] = {
        address: module.ipAddress,
        connected: (module.commandConnection)?true:false
      }
      return(a);
    }, {});
    expressSend(res, 200, body, req.path);
  }
  
  const FETCH_RESPONSES = {
    200: "OK",
    201: "Created",
    207: "Multi-Status",
    400: "Bad Request",
    404: "Not Found",
    503: "Service Unavailable",
    500: "Internal Server Error"
  };

  expressSend = function(res, code, body = null, debugPrefix = null) {
    res.status(code).send((body)?body:((FETCH_RESPONSES[code])?FETCH_RESPONSES[code]:null));
    if (debugPrefix) app.debug("%s: %d %s", debugPrefix, code, ((body)?JSON.stringify(body):((FETCH_RESPONSES[code])?FETCH_RESPONSES[code]:null)));
    return(false);
  }

  isValidKey = function(key) {
    return((key) && (key.trim().length > 0) && (!plugin.options.excludePaths.reduce((a,ep) => (a || (key.startsWith('.')?key.slice(1):key).startsWith(ep)), false)));
  }

  return(plugin);

}
