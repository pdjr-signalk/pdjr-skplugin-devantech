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

const Delta = require("./lib/signalk-libdelta/Delta.js");
const Log = require("./lib/signalk-liblog/Log.js");
const net = require('net');

const PLUGIN_ID = "devantech";
const PLUGIN_NAME = "pdjr-skplugin-devantech";
const PLUGIN_DESCRIPTION = "Signal K interface to the Devantech range of general-purpose relay modules";
const PLUGIN_SCHEMA = {
  "type": "object",
  "required": [ "modules" ],
  "properties": {
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
        "required": [ "id", "size", "deviceid", "cstring", "channels" ],
        "properties": {
          "id": { "title": "Module id", "type": "string" },
          "description": { "title": "Module description", "type": "string" },
          "size": { "title": "No of relay output channels", "type": "number" },
          "deviceid": { "title": "Device id", "type": "string" },
          "cstring": { "title": "Connection string (address:port)", "type": "string" },
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
  }
};
const PLUGIN_UISCHEMA = {};

const STATUS_INTERVAL = 5000;
const MODULE_ROOT = "electrical.switches.bank.";
const OPTIONS_DEFAULTS = {
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
};

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];
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

    if (Object.keys(options).length == 0) {
      options = OPTIONS_DEFAULTS;
    } else {
      options.statusListenerPort = (options.statusListenerPort || OPTIONS_DEFAULTS.statusListenerPort);
      options.transmitQueueHeartbeat = (options.transmitQueueHeartbeat || OPTIONS_DEFAULTS.transmitQueueHeartbeat);
      options.devices = (options.devices || []).concat(OPTIONS_DEFAULTS.devices);
    }
    app.debug("supported devices: %s", options.devices.reduce((a,d) => (a.concat(d.id.split(' '))), []).join(", "));

    // Context-free event handlers need access to the plugin
    // configuration options, so we elevate them to the plugin global
    // namespace. 
    globalOptions = options;
    options = globalOptions;
    
    // Process each defined module, interpolating data from the
    // specified device definition, then filter the result to eliminate
    // any broken modules.
    options.modules = options.modules
      .map(module => elaborateModuleConfiguration(module, options.devices))
      .filter(module => {
        if (Object.keys(module).length == 1) {
          log.W("dropping module '%s' (bad configuration)", module.id);
          return(false);
        }
        return(true);
      });

    // So now we have a list of prepared, valid, modules.

    if (options.modules.length) {

      // Save meta data for modules and channels.
      var path, value; 
      options.modules.forEach(module => {
        path = (MODULE_ROOT + module.id);
        value = {
          "description": module.description,
          "shortName": module.id,
          "longName": "Relay module " + module.id,
          "displayName": "Relay module " + module.id
        };
        delta.addMeta(path, value);
        module.channels.forEach(c => {
          path = (MODULE_ROOT +  module.id + "." + c.index + ".state");
          value = {
            "description": "Relay state (0=OFF, 1=ON)",
            "shortName": "[" + module.id + "," + c.index + "]",
            "longName": c.description + " [" + module.id + "," + c.index + "]",
            "displayName": c.description,
            "unit": "Binary switch state (0/1)",
            "type": "relay"
          };
          delta.addMeta(path, value);
        });
      });
      delta.commit().clear();

      // Install put handlers.
      options.modules.forEach(module => {
        module.channels.forEach(ch => {
          var path = MODULE_ROOT + module.id + "." + ch.index + ".state";
          app.registerPutHandler('vessels.self', path, putHandler, plugin.id);
        });
      });

      log.N("started: listening for client connections on port %d", options.statusListenerPort);
      startStatusListener(options.statusListenerPort);
      transmitQueueTimer = setInterval(processTransmitQueues, options.transmitQueueHeartbeat);
      
    } else {
      log.W("stopped: there are no usable module definitions.");
    }
  }

  /**
   * Stop the plugin by:
   * 
   * 1. Destroying all open client connections.
   * 2. Stopping the status listener.
   * 3. Stopping the transmit queue processor. 
   */
  plugin.stop = function() {
    if (statusListener) {
      statusListenerClients.forEach(client => client.destroy());
      statusListener.close();
    }
    clearTimeout(transmitQueueTimer);
    unsubscribes.forEach(f => f());
    unsubscribes = [];
  }

  /**
   * Callback function triggered by a PUT request on a switch path. The
   * function translates the PUT request into a Devantec DS TCP ASCII
   * command and places this command in the module's command queue,
   * returning a PENDING response to Signal K. The process will resolve
   * when processTransmitQueues() actually transmits the command the
   * target device and the device confirms action.
   * 
   * @param {*} context - not used. 
   * @param {*} path - path of the switch to be updated.
   * @param {*} value - requested state (0 or 1).
   * @param {*} callback - saved for use by processTransmitQueues().
   * @returns 
   */
  function putHandler(context, path, value, callback) {
    var moduleId, module, channelIndex, channel, relayCommand;
    var retval = { "state": "COMPLETED", "statusCode": 400 };
    if (moduleId = getModuleIdFromPath(path)) {
      if (module = getModuleFromModuleId(moduleId)) {
        if (module.connection) {
          if (channelIndex = getChannelIndexFromPath(path)) {
            if (channel = module.channels.reduce((a,c) => ((c.index == channelIndex)?c:a), null)) {
              relayCommand = ((value)?channel.oncommand:channel.offcommand) + "\n";
              module.commandQueue.push({ "command": relayCommand, "callback": callback });
              retval = { "state": "PENDING" };
            }
          }
        } else {
          app.debug("PUT request cannot be actioned (module '%s' has no open command connection)", module.id);
        }
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
      return(globalOptions.modules.reduce((a,m) => ((m.id == moduleId)?m:a), null));
    }
    
  }
  
  /**
   * @param {*} module - the module from which the status was received.
   * @param {*} status - the module status.
   * 
   * Update the Signal K switch paths associated with module so that
   * they conform to status.
   */
  function updatePathsFromStatus(module, status) {
    clearTimeout(module.connection.intervalId);
    var delta = new Delta(app, plugin.id);
    var error = false;
    for (var channel = 1; channel <= module.size; channel++) {
      var path = MODULE_ROOT + module.id + "." + channel + ".state";
      try {
        var value;
        switch (module.series) {
          case 'usb': value = getUsbChannelState(status, channel); break;
          case 'ds':  value = getDsChannelState(status, channel); break;
          case 'eth': value = 0;
        }
        delta.addValue(path, value);
      } catch(e) {
        error = true;
      }
    }
    delta.commit().clear();
    delete delta;
    module.connection.intervalId = setTimeout(() => module.connection.stream.write(module.statuscommand), STATUS_INTERVAL);
    if (error) throw new Error('invalid status value');

    function getDsChannelState(status, channel) {
      if (status.length == 32) {
        return((status.charAt(channel - 1) == '0')?0:1);
      } else {
        throw new Error();
      }
    }

    function getUsbChannelState(status, channel) {
      if (status.length == 1) {
        return((status.charCodeAt(0) & (1 << (channel - 1)))?1:0);
      } else {
        throw new Error();
      }
    }

  }
  
  function elaborateModuleConfiguration(module, devices) {  
    var device, oncommand, offcommand;
    var retval = { "id": module.id };

    if (module.deviceid) {
      if (device = devices.reduce((a,d) => ((d.id.split(' ').includes(module.deviceid))?d:a), null)) {
        module.statuscommand = device.statuscommand;
        module.authenticationtoken = device.authenticationtoken;
        module.commandQueue = [];
        module.currentCommand = null;
        if (module.size) {
          if (module.cobject = parseConnectionString(module.cstring)) {
            module.channels.forEach(channel => {
              oncommand = null;
              offcommand = null;
              if ((device.channels.length == 1) && (device.channels[0].address == 0)) {
                oncommand = device.channels[0].oncommand;
                offcommand = device.channels[0].offcommand;
              } else {
                oncommand = device.channels.reduce((a,c) => ((c.address == channel.index)?c.oncommand:a), null);
                offcommand = device.channels.reduce((a,c) => ((c.address == channel.index)?c.offcommand:a), null);
              }
              if (oncommand) oncommand = oncommand
                .replace('{A}', module.authenticationtoken)
                .replace("{c}", channel.index)
                .replace('{C}', String.fromCharCode(channel.index))
                .replace("{p}", module.cobject.password)
                .replace("{u}", channel.index)
              if (offcommand) offcommand = offcommand
                .replace('{A}', module.authenticationtoken)
                .replace("{c}", channel.index)
                .replace('{C}', String.fromCharCode(channel.index))
                .replace("{p}", module.cobject.password)
                .replace("{u}", channel.index)
              channel.oncommand = oncommand;
              channel.offcommand = offcommand;
            });
            retval = module;
          }
        }
      }
    }
    return(retval);
  
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

  function connectModule(module, options) {
    module.connection = net.createConnection(module.cobject.port, module.cobject.host);
    
    module.connection.on('open', () => {
      app.debug("command connection to module '%s' is open", module.id);
      module.commandQueue = [];
      module.currentCommand = null;
    });

    module.connection.on('close', () => {
      app.debug("command connection to module '%s' has closed", module.id);
      module.connection = null;
      module.commandQueue = [];
      module.currentCommand = null;
    });

    module.connection.on('data', (data) => {
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
   * The listener responds to 'connection' and 'data' events.
   * 
   * In both cases the client triggering the event is validated by
   * checking that it is defined as a module in the plugin
   * configuration.
   *  
   * @param {*} port - the port on which to listen for DS device client connections.
   */
  function startStatusListener(port) {
    statusListener = net.createServer((client) => {

      client.on('connection', (socket) => {
        var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
        var module = globalOptions.modules.reduce((a,m) => ((m.cobject.host == client.remoteAddress)?m:a), null);
        if (module) {
          app.debug("accepting connection for device at %s (module '%s')", clientIP, module.id);
          statusListenerClients.push(socket);
          socket.on('close', () => { statusListenerClients.splice(statusListenerClients.indexOf(socket), 1); });
          if (module.connection == null) {
            log.N("opening command connection for device at %s (module '%s')", clientIP, module.id, false);
            connectModule(module, globalOptions);
          }
        } else {
          app.debug("ignoring connection attempt from unconfigured device at %s", clientIP);
          client.destroy();
        }
      });

      client.on("data", (data) => {
        var clientIP = client.remoteAddress.substring(client.remoteAddress.lastIndexOf(':') + 1);
        var module = globalOptions.modules.reduce((a,m) => ((m.cobject.host == clientIP)?m:a), null);
        if (module) {
          if (module.connection == null) {
            log.N("opening command connection for device at '%s' (module '%s')", clientIP, module.id, false);
            connectModule(module, globalOptions);
          }
          try {
            var status = data.toString().split('\n')[1].trim();
            if (status.length == 32) {
              app.debug("received status '%s' from device at %s (module '%s')", status, clientIP, module.id);
              var delta = new Delta(app, plugin.id);
              for (var i = 0; i < module.size; i++) {
                var path = MODULE_ROOT + module.id + "." + (i + 1) + ".state";
                var value = (status.charAt(i) == '0')?0:1;
                delta.addValue(path, value);
              }
              delta.commit().clear();
              delete delta;
            } else throw new Error();
          } catch(e) {
            app.debug("ignoring garbled data '%s' received from device at %s (module '%s')", status, clientIP, module.id);
          }
        } else {
          app.debug("ignoring data received from unconfigured device at %s", clientIP);
          client.destroy();
        }
      });

    });

    statusListener.listen(port, () => { app.debug("status listener started on port %d", port); });
  }

  /**
   * Iterates over every module sending any available next message in
   * the command queue to the remote device.
   */
  function processTransmitQueues() {
    globalOptions.modules.forEach(module => {
      if ((module.connection) && (module.currentCommand == null) && (module.commandQueue) && (module.commandQueue.length > 0)) {
        module.currentCommand = module.commandQueue.shift();
        module.connection.write(module.currentCommand.command);
        log.N("sending '%s' to module '%s'", module.currentCommand.command.trim(), module.id);
      }
    });
  }

  return(plugin);

}
