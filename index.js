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
const Delta = require('signalk-libdelta/Delta.js');
const HttpInterface = require('signalk-libhttpinterface/HttpInterface.js');
const Log = require('signalk-liblog/Log.js');

const PLUGIN_ID = 'devantech';
const PLUGIN_NAME = 'pdjr-skplugin-devantech';
const PLUGIN_DESCRIPTION = 'Signal K interface to the Devantech DS range of general-purpose relay modules';
const PLUGIN_SCHEMA = {
  "type": "object",
  "required": [ "modules" ],
  "properties": {
    "root": {
      "title": "Root path for all switchbank keys",
      "type": "string"
    },
    "metadataPublisher": {
      "title": "Metadata publication service configuration",
      "type": "object",
      "properties": {
        "endpoint": {
          "title": "Metadata publication endpoint",
          "type": "string"
        },
        "method": {
          "title": "Metadata publication method",
          "type": "string",
          "enum": [ "PATCH", "POST", "PUT" ]
        },
        "credentials": {
          "title": "Metadata publisher credentials",
          "type": "string"
        }
      }
    },
    "statusListenerPort": {
      "title": "Port on which to listen for module status reports",
      "type": "number"
    },
    "transmitQueueHeartbeat": {
      "title": "Process the transmit queue every this many miliseconds",
      "type": "number"
    },
    "modules" : {
      "title": "Module configurations",
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "required": [ "id", "connectionString", "channels" ],
        "properties": {
          "id": {
            "title": "Module id",
            "type": "string"
          },
          "connectionString": {
            "title": "Connection string (address:port)",
            "type": "string"
          },
          "description": {
            "title": "Module description",
            "type": "string"
          },
          "deviceId": {
            "title": "Device id",
            "type": "string"
          },
          "relayChannels": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [ "index" ],
              "properties": {
                "index": {
                  "title": "Signal K channel index",
                  "type": "number"
                },
                "address": {
                  "title": "Address of associated relay channel on physical device",
                  "type": "number"
                },
                "description": {
                  "title": "Channel description",
                  "type": "string"
                }
              }
            }
          },
          "switchChannels": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [ "index" ],
              "properties": {
                "index": {
                  "title": "Signal K channel index",
                  "type": "number"
                },
                "address": {
                  "title": "Address of associated switch channel on physical device",
                  "type": "number"
                },
                "description": {
                  "title": "Channel description",
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
    "root": "electrical.switches.bank.",
    "metadataPublisher": { "method": "POST" },
    "statusListenerPort": 28241,
    "commandQueueHeartbeat" : 25,
    "modules": [],
    "devices": [
      {
        "id": "DS",
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

  var statusListener = null;
  var transmitQueueTimer = null;

  plugin.start = function(options) {
    plugin.options = _.cloneDeep(plugin.schema.default);
    _.merge(plugin.options, options);
    
    // Process each defined module, interpolating data from the
    // specified device definition, then filter the result to eliminate
    // any broken modules.
    plugin.options.modules = plugin.options.modules.reduce((a,module) => {
      try {
        a.push(canonicaliseModule(module, plugin.options.devices));
      } catch(e) {
        log.E(`invalid configuration for module '${module.id}' (${e.message}`);
      }
      return(a);
    },[]);

    app.debug(`using configuration: ${JSON.stringify(plugin.options, null, 2)}`);
  
    if (plugin.options.modules.length > 0) {

      app.debug(JSON.stringify(createMetadata(), null, 2));

      // Create and install metadata
      publishMetadata(createMetadata(), plugin.options.metadataPublisher, (e) => {
        if (e) {
          log.W(`publish failed (${e.message})`, false);
          (new Delta(app, plugin.id)).addMetas(createMetadata()).commit().clear();  
        } else {
          app.debug('metadata published');
        }
      });

      // Install put handlers.
      options.modules.forEach(module => {
        module.relayChannels.forEach(channel => {
          var path = `${plugin.options.root}${module.id}R.${channel.index}.state`;
          app.registerPutHandler('vessels.self', path, relayPutHandler, plugin.id);
        });
      });

      // Start listening for remote DS status reports and begin checking
      // the transmit queue.
      log.N(`listening for DS module connections on port ${plugin.options.statusListenerPort}`);
      startStatusListener(plugin.options.statusListenerPort);
      transmitQueueTimer = setInterval(processCommandQueues, plugin.options.transmitQueueHeartbeat);
    } else {
      log.E('there are no usable module definitions.');
    }
  }

  /**
   * Clean uo plugin resources and services by destroying open client
   * connections, stopping the status listener and stopping the
   * transmit queue processor. 
   */
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

  /**
   * Generate an object containing path => { metadata } mappings for
   * switchbanks and relay/switch channels.
   * 
   * @returns metadata for every path maintained by the plugin
   */
  function createMetadata() {
    return(plugin.options.modules.reduce((a,module) => {
      if (module.relayChannels) { // We have a relay module
        a[`${plugin.options.root}${module.id}R`] = {
          description: module.description || `Relay module ${module.id}R`,
          instance: `${module.id}R`,
          type: 'relay',
          channelCount: module.relayChannels.length,
          shortName: `${module.id}R`,
          longName: `Relay module ${module.id}R`,
          displayName: `Relay module ${module.id}R`,
          $source: `plugin:${plugin.id}`
        };
        (module.relayChannels || []).forEach(channel => {
          a[`${plugin.options.root}${module.id}R.${channel.index}.state`] = {
            description: channel.description || `Relay channel ${channel.index}`,
            index: channel.index,
            address: channel.address,
            shortName: `[${module.id}R,${channel.index}]`,
            longName: `[${module.id}R,${channel.index}]`,
            displayName: channel.description || `[${module.id}R,${channel.index}]`,
            unit: 'Binary switch state (0/1)',
            type: 'relay'
          };
        });
      }
      if (module.switchChannels) { // We have a switch module
        a[`${plugin.options.root}${module.id}S`] = {
          description: module.description || `Switch module ${module.id}S`,
          instance: `${module.id}S`,
          type: 'switch',
          channelCount: module.switchChannels.length,
          shortName: `${module.id}S`,
          longName: `Switch module ${module.id}S`,
          displayName: `Switch module ${module.id}S`,
          $source: `plugin:${plugin.id}`
        };
        (module.switchChannels || []).forEach(channel => {
          a[`${plugin.options.root}${module.id}S.${channel.index}.state`] = {
            description: channel.description || `Switch channel ${channel.index}`,
            index: channel.index,
            address: channel.address,
            shortName: `[${module.id}S,${channel.index}]`,
            longName: `[${module.id}S,${channel.index}]`,
            displayName: channel.description || `[${module.id}S,${channel.index}]`,
            unit: 'Binary switch state (0/1)',
            type: 'switch'
          };
        });
      }
      return(a);
    },{}));
  }

  // Publish metadata object to publisher. If all goes awry, then
  // call callback with an error.
  function publishMetadata(metadata, publisher, callback, options={ retries: 3, interval: 10000 }) {
    if ((publisher) && (publisher.endpoint) && (publisher.method) && (publisher.credentials)) {
      const httpInterface = new HttpInterface(app.getSelfPath('uuid'));
      httpInterface.getServerAddress().then((serverAddress) => {
        httpInterface.getServerInfo().then((serverInfo) => {
          const [ username, password ] = publisher.credentials.split(':');
          httpInterface.getAuthenticationToken(username, password).then((token) => {
            const intervalId = setInterval(() => {
              if (options.retries-- === 0) {
                clearInterval(intervalId);
                callback(new Error(`tried ${options.retries} times with no success`));
              }
              fetch(`${serverAddress}${publisher.endpoint}`, { "method": publisher.method, "headers": { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }, "body": JSON.stringify(metadata) }).then((response) => {
                if (response.status == 200) {
                  clearInterval(intervalId);
                  callback();
                }
              }).catch((e) => {
                clearInterval(intervalId);
                callback(new Error(e));
              });
            }, options.interval);
          }).catch((e) => callback(new Error('error recovering access token')));
        }).catch((e) => callback(new Error('error recovering server info')));
      }).catch((e) => callback(new Error('error recovering server address')));
    } else {
      callback(new Error(`'metadataPublisher' configuration is invalid`));
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
    if (moduleId = getModuleIdFromPath(path)) {
      if (module = getModuleFromModuleId(moduleId)) {
        if (module.commandConnection) {
          if (channelIndex = getChannelIndexFromPath(path)) {
            if (channel = module.relayChannels.reduce((a,c) => ((c.index == channelIndex)?c:a), null)) {
              relayCommand = ((value)?channel.oncommand:channel.offcommand);
              module.commandQueue.push({ command: relayCommand, callback: callback });
              retval = { state: 'PENDING' };
            }
          }
        } else {
          app.debug(`PUT request cannot be actioned (module '${module.id}' has no open command connection)`);
        }
      } else {
        app.debug(`module '${moduleId}' is not defined`);
      }
    }
    return(retval);

    function getModuleIdFromPath(path) {
      var parts = path.split('.');
      return((parts.length >= 4)?parts[3].slice(0,-1):null);
    }
  
    function getChannelIndexFromPath(path) {
      var parts = path.split('.');
      return((parts.length >= 5)?parts[4]:null);
    }
  
    function getModuleFromModuleId(moduleId) {
      return(plugin.options.modules.reduce((a,m) => ((m.id == moduleId)?m:a), null));
    }
    
  }
  
  /********************************************************************
   * Takes a perhaps partial module definition and does what it can to
   * parse encoded bits and add important defaults.
   * 
   * @param {*} module - the module object to be processed. 
   * @param {*} devices - array of available device definitions.
   * @returns - the dressed-up module or {} on error.
   */
  function canonicaliseModule(module, devices) {     
    const device = devices.reduce((a,d) => ((d.id.split(' ').includes(module.deviceId))?d:a), null);
    if (!device) throw new Error(`device '${module.deviceId}' is not configured`);

    if (!module.id) throw new Error("missing module 'id'");
    if (!module.deviceId) throw new Error("missing 'deviceId'");
    if (!module.connectionString) throw new Error("missing 'connectionString'");

    module.connectionObject = parseConnectionString(module.connectionString);
    module.commandQueue = [];
    module.currentCommand = null;

    if ((!module.relayChannels) && (!module.switchChannels)) throw new Error("no channels are configured");

    if (module.relayChannels) {
      module.relayChannels.forEach(channel => {
        if (!channel.index) throw new Error("missing channel index");
        channel.address = (channel.address || channel.index);
        channel.description = (channel.description || `Relay channel ${channel.index}`);

        if (!device.channels) throw new Error(`missing channel configuration for device '${device.id}'`);
        if ((device.channels[0].address == 0) && (device.channels.length == 1)) {
          channel.oncommand = device.channels[0].oncommand;
          channel.offcommand = device.channels[0].offcommand;
        } else {
          channel.oncommand = device.channels.reduce((a,c) => ((c.address == channel.address)?c.oncommand:a), null);
          channel.offcommand = device.channels.reduce((a,c) => ((c.address == channel.address)?c.offcommand:a), null);
        }
        if ((channel.oncommand === null) || (channel.offcommand === null)) throw new Error(`missing operating command for channel ${channel.id}`);
        channel.oncommand = channel.oncommand.replace('{c}', channel.address);
        channel.offcommand = channel.offcommand.replace('{c}', channel.address);
      });
    }
    if (module.switchChannels) {
      module.switchChannels.forEach(channel => {
        if (!channel.index) throw new Error("missing channel index");
        channel.address = (channel.address || channel.index);
        channel.description = (channel.description || `Switch channel ${channel.index}`);  
      })
    }
    return(module);

    /**
     * Make a connection object with properties 'host', 'port' and
     * optionally 'password' from \ref connectionString.
     * 
     * @param {*} connectionString - the string to be parsed. 
     * @returns - on success, an object, otherwise null.
     */
    function parseConnectionString(connectionString) {
      var connectionObject = null;

      if (matches = connectionString.match(/^(.*)@(.*)\:(.*)$/)) {
        connectionObject = { password: matches[1], host: matches[2], port: matches[3] };
      } else if (matches = connectionString.match(/^(.*)\:(.*)$/)) {
        connectionObject = { host: matches[1], port: matches[2] };
      } else {
        throw new Error("could not parse connection string");
      }
      return(connectionObject);
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
    app.debug(`opening command connection`);
    module.commandConnection = net.createConnection(module.connectionObject.port, module.connectionObject.host);
    
    module.commandConnection.on('open', (socket) => {
      app.debug(`command connection to module '${module.id}' is open`);
      module.commandConnection = socket;
      module.commandQueue = [];
      module.currentCommand = null;
    });

    module.commandConnection.on('close', () => {
      app.debug(`command connection to module '${module.id}' has closed`);
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
          app.debug(`orphan command response received from module '${module.id}'`);
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
    statusListener = net.createServer((client) => {

      /**
       * Extracts relay and digital input state information from <data>
       * and updates configured Signal K relay and switchbanks.
       */
      client.on('data', (data) => {
        try {
          var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
          var module = plugin.options.modules.reduce((a,m) => ((m.connectionObject.host == clientIP)?m:a), null);
          if (module) {
            const messageLines = data.toString().split('\n');
            const relayStates = messageLines[1].trim();
            const switchStates = messageLines[2].replaceAll(' ','').trim();
            app.debug(`received status: ${relayStates} ${switchStates}`);
            var delta = new Delta(app, plugin.id);
            if (module.relayChannels) {
              if (relayStates.length == 32) {
                for (var i = 0; i < module.relayChannels.length; i++) {
                  var path = `${plugin.options.root}${module.id}R.${module.relayChannels[i].index}.state`;
                  var value = (relayStates.charAt(module.relayChannels[i].address - 1) == '0')?0:1;
                  delta.addValue(path, value);
                }
              } else throw new Error(`invalid relay status '${relayStates}'`);
            }
            if (module.switchChannels) {
              if (switchStates.length == 8) {
                for (var i = 0; i < module.switchChannels.length; i++) {
                  var path = `${plugin.options.root}${module.id}S.${module.switchChannels[i].index}.state`;
                  var value = (switchStates.charAt(module.switchChannels[i].address - 1) == '0')?0:1;
                  delta.addValue(path, value);
                }
              } else throw new Error(`invalid switch status '${switchStates}'`);
            }
            delta.commit().clear();
            delete delta;
          } else throw new Error(`status received from unknown module at ${clientIP}`);
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
        app.debug(`status listener: closing connection for device at ${clientIP}`)
        module.listenerConnection.destroy();
        module.listenerConnection = null;
      });

      /**
       * Only allow connections from configured modules.
       */
      var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
      var module = plugin.options.modules.reduce((a,m) => ((m.connectionObject.host == clientIP)?m:a), null);
      if (module) {
        app.debug(`status listener: opening connection for device at ${clientIP} (module '${module.id}')`);
        if (module.listenerConnection) module.listenerConnection.destroy();
        module.listenerConnection = client;

        if (!module.commandConnection) {
          log.N(`status listener: opening command connection for module '${module.id}'`, false);
          openCommandConnection(module);
        }
      } else {
        log.W(`status listener: ignoring connection attempt from device ${clientIP} (not a module)`, false);
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
    plugin.options.modules.forEach(module => {
      if ((module.commandConnection) && (module.currentCommand == null) && (module.commandQueue) && (module.commandQueue.length > 0)) {
        module.currentCommand = module.commandQueue.shift();
        if (module.commandConnection) {
          module.commandConnection.write(`${module.currentCommand.command}\n`);
          log.N(`sending '${module.currentCommand.command}' to module '${module.id}'`);
        } else {
          log.E(`cannot send command to module '${module.id}' (no connection)`);
        }
      }
    });
  }

  /********************************************************************
   * Express handlers...
   */

  handleExpress = function(req, res, handler) {
    app.debug(`processing ${req.method} request on '${req.path}`);
    handler(req, res);
  }

  expressGetStatus = function(req, res) {
    const body = plugin.options.modules.reduce((a,module) => {
      a[module.id] = {
        device: module.commandConnection.remoteAddress()
      }
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
