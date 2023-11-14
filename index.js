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
      "type": "number",
      "default": 24281
    },
    "transmitQueueHeartbeat": {
      "type": "number",
      "default": 25
    },
    "modules" : {
      "title": "Modules",
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "required": [ "id", "cstring", "channels" ],
        "properties": {
          "id": { "title": "Module id", "type": "string" },
          "cstring": { "title": "Connection string (address:port)", "type": "string" },
          "description": { "title": "Module description", "type": "string" },
          "deviceid": { "title": "Device id", "type": "string" },
          "channels": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [ "index" ],
              "properties": {
                "index": {
                  "title": "Channel index",
                  "type": "number"
                },
                "address": {
                  "title": "Address of associated relay on physical device",
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
          "id": { "title": "Device identifier", "type": "string" },
          "channels" : {
            "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "address": { "title": "Relay channel address/index", "type": "number" },
                  "oncommand": { "title": "ON command", "type": "string" },
                  "offcommand": { "title": "OFF command", "type": "string" }
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
          { "address": 0, "oncommand": "SR {c} ON", "offcommand": "SR {c} OFF" }
        ]
      }
    ]
  }
};
const PLUGIN_UISCHEMA = {};

module.exports = function(app) {
  var plugin = {};
  var globalOptions = null;

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;
  plugin.schema = PLUGIN_SCHEMA;
  plugin.uiSchema = PLUGIN_UISCHEMA;

  const delta = new Delta(app, plugin.id);
  const log = new Log(plugin.id, { "ncallback": app.setPluginStatus, "ecallback": app.setPluginError });

  var statusListener = null;
  var statusListenerClients = [];
  var transmitQueueTimer = null;

  plugin.start = function(options) {
    plugin.options = _.cloneDeep(plugin.schema.properties.default);
    _.merge(plugin.options, options);
    app.debug(`supported devices: ${options.devices.reduce((a,d) => (a.concat(d.id.split(' '))), []).join(", ")}`);
  
    if ((plugin.options.modules) && (Array.isArray(plugin.options.modules)) && (plugin.options.modules.length > 0)) {

      // Process each defined module, interpolating data from the
      // specified device definition, then filter the result to eliminate
      // any broken modules.
      plugin.options.modules = plugin.options.modules.map(module => normaliseModuleConfiguration(module, plugin.options.devices)).filter(module => {
        try {
          validateModuleConfiguration(module);
          return(true);
        } catch(e) {
          log.E(`invalid configuration for module '${module.id}' (${e.message}`);
        return(false);
        }
      });

      // So now we have a list of prepared, valid, modules.
      if (plugin.options.modules.length > 0) {
        // Create and install metadata
        publishMetadata(createMetadata(), plugin.options.metadataPublisher, (e) => {
          if (e) {
            log.W(`publish failed (${e.message})`, false);
            (new Delta(app, plugin.id)).addMetas(createMetadata()).commit().clear();
          } else {
            log.N(`metadata published to '${plugin.options.metadataPublisher.endpoint}'`, false);
          }
        });
        // Install put handlers.
        options.modules.forEach(module => {
          module.channels.forEach(channel => {
            var path = `${plugin.options.root}${module.id}.${channel.index}.state`;
            app.registerPutHandler('vessels.self', path, putHandler, plugin.id);
          });
        });
        // Start listening for remote DS status reports and begin checking
        // the transmit queue.
        log.N(`listening for DS module connections on port ${plugin.options.statusListenerPort}`);
        startStatusListener(plugin.options.statusListenerPort);
        transmitQueueTimer = setInterval(processTransmitQueues, plugin.options.transmitQueueHeartbeat);
      } else {
        log.E('there are no usable module definitions.');
      }
    } else {
      log.E('plugin configuration contains no usable module definitions.');
    }
  }

  /**
   * Clean uo plugin resources and services by destroying open client
   * connections, stopping the status listener and stopping the
   * transmit queue processor. 
   */
  plugin.stop = function() {
    options.modules.forEach(module => {
      if (module.listenerConnection) module.listenerConnection.destroy();
      if (module.commandConnection) module.commandConnection.destroy();
    });
    if (statusListener) statusListener.close();
    clearTimeout(transmitQueueTimer);
  }

  function createMetadata() {
    return(plugin.options.modules.reduce((a,module) => {
      a[`${plugin.options.root}${module.id}`] = {
        description: module.description,
        shortName: module.id,
        longName: `Relay module ${module.id}`,
        displayName: `Relay module ${module.id}`,
        type: 'relay',
        channelCount: (module.channels || []).length,
        $source: `plugin:${plugin.id}`
      };
      (module.channels || []).forEach(channel => {
        a[`${plugin.options.root}${module.id}.${channel.index}.state`] = {
          description: 'Relay state (0=OFF, 1=ON)',
          shortName: `[${module.id},${channel.index}]`,
          longName: `${channel.description} [${module.id},${channel.index}]`,
          displayName: `${channel.description}`
          unit: 'Binary switch state (0/1)',
          type: 'relay'
        };
      });
      return(a);
    },{}));
  }


  // Publish metadata object to publisher.
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
          })
        })
      })
    } else {
      callback(new Error(`'metadataPublisher' configuration is invalid`));
    }
  }

  /**
   * Handler function triggered by a PUT request on a switch path.
   * 
   * The function recovers a command string dictated by path and value
   * and places this and the passed callback into the module's command
   * queue returning a PENDING response to Signal K.
   * 
   * The PUT handling process will resolve when processTransmitQueues() 
   * actually transmits the command to the target device and the device
   * confirms action.
   * 
   * @param {*} context - not used. 
   * @param {*} path - path of the switch to be updated.
   * @param {*} value - requested state (0 or 1).
   * @param {*} callback - saved for use by processTransmitQueues().
   * @returns PENDING on success, COMPLETED/400 on error.
   */
  function putHandler(context, path, value, callback) {
    var moduleId, module, channelIndex, channel, relayCommand;
    var retval = { "state": "COMPLETED", "statusCode": 400 };
    if (moduleId = getModuleIdFromPath(path)) {
      if (module = getModuleFromModuleId(moduleId)) {
        if (module.commandConnection) {
          if (channelIndex = getChannelIndexFromPath(path)) {
            if (channel = module.channels.reduce((a,c) => ((c.index == channelIndex)?c:a), null)) {
              relayCommand = ((value)?channel.oncommand:channel.offcommand);
              module.commandQueue.push({ "command": relayCommand, "callback": callback });
              retval = { "state": "PENDING" };
            }
          }
        } else {
          app.debug("PUT request cannot be actioned (module '%s' has no open command connection)", module.id);
        }
      } else {
        app.debug("module '%s' is not defined", moduleId);
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
  
    function getModuleFromModuleId(moduleId) {
      return(plugin.options.modules.reduce((a,m) => ((m.id == moduleId)?m:a), null));
    }
    
  }
  
  /**
   * Takes a perhaps partial module definition and does what it can to
   * parse encoded bits and add important defaults.
   * 
   * @param {*} module - the module object to be processed. 
   * @param {*} devices - array of available device definitions.
   * @returns - the dressed-up module or {} on error.
   */
  function normaliseModuleConfiguration(module, devices) {  
    var device, oncommand, offcommand;
    var retval = {};

    if (module.id && (module.id != "")) {
      if (module.deviceid || (module.deviceid = 'DS')) {
        if (device = devices.reduce((a,d) => ((d.id.split(' ').includes(module.deviceid))?d:a), null)) {
          if (module.cobject = parseConnectionString(module.cstring)) {
            module.commandQueue = [];
            module.currentCommand = null;
            if (module.channels.length) {
              module.channels.forEach(channel => {
                channel.address = (channel.address || channel.index);
                oncommand = null;
                offcommand = null;
                if ((device.channels.length == 1) && (device.channels[0].address == 0)) {
                  oncommand = device.channels[0].oncommand;
                  offcommand = device.channels[0].offcommand;
                } else {
                  oncommand = device.channels.reduce((a,c) => ((c.address == channel.address)?c.oncommand:a), null);
                  offcommand = device.channels.reduce((a,c) => ((c.address == channel.address)?c.offcommand:a), null);
                }
                channel.oncommand = (oncommand)?oncommand.replace("{c}", channel.address):null;
                channel.offcommand = (offcommand)?offcommand.replace("{c}", channel.address):null;
              });
              retval = module;
            }
          }
        }
      }
    }
    return(retval);

    /**
     * Make a connection object with properties 'host', 'port' and
     * optionally 'password' from \ref cstring.
     * 
     * @param {*} cstring - the string to be parsed. 
     * @returns - on success, an object, otherwise null.
     */
    function parseConnectionString(cstring) {
      var retval = null;

      if (matches = cstring.match(/^(.*)@(.*)\:(.*)$/)) {
        retval = { "password": matches[1], "host": matches[2], "port": matches[3] };
      } else if (matches = cstring.match(/^(.*)\:(.*)$/)) {
        retval = { "host": matches[1], "port": matches[2] };
      }
      return(retval);
    }
  }

  /**
   * Checks a module definition for the essential bits, throwing an
   * exception if things aren't usable.
   * 
   * @param {*} module - the module to be validated. 
   */
  function validateModuleConfiguration(module) {
    if (!module.id) throw new Error("bad or missing 'id'");
    if (!module.deviceid) throw new Error("bad or missing 'deviceid'");
    if (!module.cobject) throw new Error("bad or missing 'cstring'");
    if (!module.channels.length) throw new Error("bad or missing channel definitions");
  }

  /**
   * Connects module to the TCP command connection specified by
   * module.cobject, setting module.commandConnection to the new
   * connection stream and arranging for subsequent processing.
   * 
   * @param {*} module - the module to be connected.
   */
  function openCommandConnection(module) {
    module.commandConnection = net.createConnection(module.cobject.port, module.cobject.host);
    
    module.commandConnection.on('open', (socket) => {
      app.debug("command connection to module '%s' is open", module.id);
      module.commandConnection = socket;
      module.commandQueue = [];
      module.currentCommand = null;
    });

    module.commandConnection.on('close', () => {
      app.debug("command connection to module '%s' has closed", module.id);
      module.commandConnection.destroy();
      module.commandQueue = [];
      module.currentCommand = null;
    });

    module.commandConnection.on('data', (data) => {
      if (data.toString().trim() == "Ok") {
        if (module.currentCommand) {
          module.currentCommand.callback({ "state": "COMPLETED", "statusCode": 200});
          module.currentCommand = null;
        } else {
          app.debug("orphan command response received from module '%s'", module.id);
        }
      }
    });

  }

  /**
   * Open an event notification listener on a specified port.
   * 
   * DS modules create a new connection for every event notification,
   * so things here get a little busy. When a valid module connects a
   * new command connection is made, but this is preserved when the
   * remote device closes the status reporting connection.
   *  
   * @param {*} port - the port on which to listen for DS device client connections.
   */
  function startStatusListener(port) {
    statusListener = net.createServer((client) => {

      client.on("data", (data) => {
        var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
        var module = plugin.options.modules.reduce((a,m) => ((m.cobject.host == clientIP)?m:a), null);
        if (module) {
          try {
            var status = data.toString().split('\n')[1].trim();
            if (status.length == 32) {
              app.debug("status listener: received status '%s' from device at %s (module '%s')", status, clientIP, module.id);
              var delta = new Delta(app, plugin.id);
              for (var i = 0; i < module.channels.length; i++) {
                var path = MODULE_ROOT + module.id + "." + module.channels[i].index + ".state";
                var value = (status.charAt(i) == '0')?0:1;
                delta.addValue(path, value);
              }
              delta.commit().clear();
              delete delta;
            } else throw new Error();
          } catch(e) {
            app.debug("status listener: ignoring non-status data ('%s') received from device at %s (module '%s')", status, clientIP, module.id);
          }
        }
      });

      client.on('close', () => {
        var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
        app.debug("status listener: closing connection for device at %s", clientIP)
        module.listenerConnection.destroy();
        module.listenerConnection = null;
      });

      var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
      var module = plugin.ptions.modules.reduce((a,m) => ((m.cobject.host == clientIP)?m:a), null);
      if (module) {
        app.debug("status listener: opening connection for device at %s (module '%s')", clientIP, module.id);
        if (module.listenerConnection) module.listenerConnection.destroy();
        module.listenerConnection = client;

        if (module.commandConnection == null) {
          log.N("status listener: opening command connection for module '%s'", clientIP, module.id, false);
          openCommandConnection(module);
        }
      } else {
        log.W("status listener: ignoring connection attempt from device %s (not a module)", clientIP, false);
        client.destroy();
      }
    });
    
    statusListener.listen(port, () => { app.debug("status listener: listening on port %d", port); });
  }

  /**
   * Iterates over every module sending any available message in the
   * command queue to the remote device.
   */
  function processTransmitQueues() {
    plugin.ptions.modules.forEach(module => {
      if ((module.commandConnection) && (module.currentCommand == null) && (module.commandQueue) && (module.commandQueue.length > 0)) {
        module.currentCommand = module.commandQueue.shift();
        if (module.commandConnection) {
          module.commandConnection.write(module.currentCommand.command + "\n");
          log.N("sending '%s' to module '%s'", module.currentCommand.command, module.id);
        } else {
          log.E("cannot send command to module '%s' (no connection)", module.id);
        }
      }
    });
  }

  return(plugin);

}
