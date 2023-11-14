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
const Delta = require('signalk-libdelta/Delta.js');
const Log = require('signalk-liblog/Log.js');

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
  }
};
const PLUGIN_UISCHEMA = {};

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

    if (Object.keys(options).length > 0) {  
      options.statusListenerPort = (options.statusListenerPort || OPTIONS_DEFAULTS.statusListenerPort);
      options.transmitQueueHeartbeat = (options.transmitQueueHeartbeat || OPTIONS_DEFAULTS.transmitQueueHeartbeat);
      options.devices = (options.devices || []).concat(OPTIONS_DEFAULTS.devices);
      app.debug("supported devices: %s", options.devices.reduce((a,d) => (a.concat(d.id.split(' '))), []).join(", "));
      if ((options.modules) && (Array.isArray(options.modules)) && (options.modules.length > 0)) {

        // Context-free event handlers need access to the plugin
        // configuration options, so we elevate them to the plugin global
        // namespace. 
        globalOptions = options;
        options = globalOptions;
    
        // Process each defined module, interpolating data from the
        // specified device definition, then filter the result to eliminate
        // any broken modules.
        options.modules = options.modules
          .map(module => normaliseModuleConfiguration(module, options.devices))
          .filter(module => {
            try {
              validateModuleConfiguration(module);
              return(true);
            } catch(e) {
              log.E("invalid configuration for module '%s' (%s)", module.id, e.message);
              return(false);
            }
          });

        // So now we have a list of prepared, valid, modules.
        if (options.modules.length > 0) {
          // Save meta data for modules and channels.
          var path, value; 
          options.modules.forEach(module => {
            path = (MODULE_ROOT + module.id);
            value = { "description": module.description, "shortName": module.id, "longName": "Relay module " + module.id, "displayName": "Relay module " + module.id };
            delta.addMeta(path, value);
            module.channels.forEach(c => {
              path = (MODULE_ROOT +  module.id + "." + c.index + ".state");
              value = { "description": "Relay state (0=OFF, 1=ON)", "shortName": "[" + module.id + "," + c.index + "]", "longName": c.description + " [" + module.id + "," + c.index + "]", "displayName": c.description, "unit": "Binary switch state (0/1)", "type": "relay" };
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

          // Start listening for remote DS status reports and begin checking
          // the transmit queue.
          log.N("listening for DS module connections on port %d", options.statusListenerPort);
          startStatusListener(options.statusListenerPort);
          transmitQueueTimer = setInterval(processTransmitQueues, options.transmitQueueHeartbeat);
      
        } else {
          log.E("there are no usable module definitions.");
        }
      } else {
        log.E("plugin configuration contains no usable module definitions.");
      }
    } else {
      log.E("plugin configuration file is missing or unusable");
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
      return(globalOptions.modules.reduce((a,m) => ((m.id == moduleId)?m:a), null));
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
        var module = globalOptions.modules.reduce((a,m) => ((m.cobject.host == clientIP)?m:a), null);
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
      var module = globalOptions.modules.reduce((a,m) => ((m.cobject.host == clientIP)?m:a), null);
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
    globalOptions.modules.forEach(module => {
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
