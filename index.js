/**********************************************************************
 * Copyright 2018 Paul Reeve <preeve@pdjr.eu>
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
const SerialPort = require('./node_modules/serialport');
const ByteLength = require('./node_modules/@serialport/parser-byte-length')
const net = require('net');
const fs = require('fs');

const PLUGIN_ID = "devantech";
const PLUGIN_NAME = "pdjr-skplugin-devantech";
const PLUGIN_DESCRIPTION = "Signal K interface to the Devantech range of general-purpose relay modules";
const PLUGIN_SCHEMA = {
  "type": "object",
  "properties": {
    "modules" : {
      "title": "Modules",
      "type": "array",
      "default": [],
      "items": {
        "type": "object",
        "required": [ "id", "deviceid", "cstring", "channels" ],
        "properties": {
          "id": { "title": "Signal K module id", "type": "string" },
          "description": { "title": "Module description", "type": "string" },
          "deviceid": { "title": "Device id", "type": "string" },
          "devicecstring": { "title": "Connection string", "type": "string" },
          "channels": {
            "type": "array",
            "items": {
              "type": "object",
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
        "required" : [ "id", "size", "protocols" ],
        "properties": {
          "id": { "title": "Device identifier", "type": "string" },
          "size": { "title": "Number of relay channels", "type": "number" },
          "protocols": {
            "title": "Protocols supported by this module",
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "title": "Protocol id", "type": "string", "enum": [ "http", "https", "tcp", "usb" ] },
                "statuscommand": { "title": "Status command", "type": "string" },
                "statuslength": { "title": "Status result length in bytes", "type": "number", "default": 1 },
                "channels" : {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "address": { "title": "Relay channel address/index", "type": "number" },
                      "oncommand": { "title": "ON command", "type": "string" },
                      "offcommand": { "title": "OFF command", "type": "string" },
                      "statuscommand": { "title": "Status command", "type": "string" },
                      "statusmask": { "title": "Mask to reveal channel state", "type": "number" }
                    }
                  }
                }
              }
            }
          } 
        }
      }
    }
  },
  "default": {
    "modules": [],
    "devices": []
  }
};
const PLUGIN_UISCHEMA = {};

const STATUS_INTERVAL = 5000;
const MODULE_ROOT = "electrical.switches.bank.";
const DEFAULT_DEVICES = [
  {
    "id": "USB-RLY02-SN USB-RLY02 USB-RLY82 USB-RLY08B USB-RLY16 USB-RLY16L USB-OPTO-RLY88 USB-OPTO-RLY816",
    "series": "usb",
    "statuscommand": "[",
    "channels": [
      { "address": 1, "oncommand": "e", "offcommand": "o" },
      { "address": 2, "oncommand": "f", "offcommand": "p" },
      { "address": 3, "oncommand": "g", "offcommand": "q" },
      { "address": 4, "oncommand": "h", "offcommand": "r" },
      { "address": 5, "oncommand": "i", "offcommand": "s" },
      { "address": 6, "oncommand": "j", "offcommand": "t" },
      { "address": 7, "oncommand": "k", "offcommand": "u" },
      { "address": 8, "oncommand": "l", "offcommand": "v" }
    ]
  },
  {
    "id": "DS2824",
    "series": "ds",
    "statuscommand": "ST",
    "channels": [
      { "address": 0, "oncommand": "SR {c} ON", "offcommand": "SR {c} OFF" }
    ]
  }
];

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

  plugin.start = function(options) {
  
    // Context-free event handlers need access to the plugin
    // configuration options, so we elevate them to the plugin global
    // namespace. 
    globalOptions = options;

    // If the user has configured their own devices, then add them
    // to the embedded defaults.
    options.devices = (options.devices || []).concat(DEFAULT_DEVICES);
    app.debug("supported devices: %s", options.devices.reduce((a,d) => (a.concat(d.id.split(' '))), []).join(", "));

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
    log.N("started: operating %d module%s (%s)", options.modules.length, ((options.modules.length == 1)?"":"s"), options.modules.map(m => m.id).join(","));

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

      options.modules.forEach(module => {
        app.debug("module %s: trying to connect... (%s)", module.id, module.cstring);

        connectModule(module, {
          // Once module is open, request a status update and register
          // a PUT handler for every channel path.
          onopen: (module) => { 
            app.debug("module %s: ...connected", module.id); 
            module.connection.stream.write(module.statuscommand);
          },
          // Incoming data is either a response to a channel update
          // or a response to a status request. We use the received
          // data to update Signal K paths with the channel states.
          ondata: (module, status) => {
            app.debug("module %s: received '%s'", module.id, status);
            try {
              updatePathsFromStatus(module, status);
            } catch(e) {
              app.debug("module '%s': %s", e.message);
            }
          },
          // TCP connection closed by remote module. This is really an
          // error.
          onclose: (module) => {
            if (module.connection.intervalId) { clearInterval(module.connection.intervalId); module.connection.intervalId = null; }
            log.E("module '%s' closed comms connection", module.id); 
          },
          onError: (module) => {
            log.E("module '%s' connection error", module.id); 
          }
        });
      });
    } else {
      log.W("stopped: there are no usable module definitions.");
    }
  }

  plugin.stop = function() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    unsubscribes.forEach(f => f());
    unsubscribes = [];
  }

  /**
   * Callback function triggered by a PUT request on a switch path. The
   * function translates the PUT request into a Devantec DS TCP ASCII
   * command and transmits this to the associated relay device.
   * 
   * @param {*} context - not used. 
   * @param {*} path - path of the switch to be updated.
   * @param {*} value - requested state (0 or 1).
   * @param {*} callback - not used.
   * @returns 
   */
  function putHandler(context, path, value, callback) {
    var moduleId, module, channelIndex, channel, relayCommand;
    var retval = { "state": "COMPLETED", "statusCode": 400 };
    if (moduleId = getModuleIdFromPath(path)) {
      if (module = getModuleFromModuleId(moduleId)) {
        if (channelIndex = getChannelIndexFromPath(path)) {
          if (channel = module.channels.reduce((a,c) => ((c.index == channelIndex)?c:a), null)) {
            relayCommand = ((value)?channel.oncommand:channel.offcommand) + "\n";
            module.connection.stream.write(relayCommand);
            retval.statusCode = 200;
            log.N("sending '%s' to module '%s'", relayCommand.trim(), moduleId);
          }
        }
      }
    }
    return(retval);

    function getModuleFromModuleId(moduleId) {
      return(globalOptions.modules.reduce((a,m) => ((m.id == moduleId)?m:0), null));
    }
  
    function getModuleIdFromPath(path) {
      var parts = path.split('.');
      return((parts.length >= 4)?parts[3]:null);
    }
  
    function getChannelIndexFromPath(path) {
      var parts = path.split('.');
      return((parts.length >= 5)?parts[4]:null);
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
        module.series = device.series;
        module.statuscommand = device.statuscommand;
        module.authenticationtoken = device.authenticationtoken;
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

      if (matches = cstring.match(/^(.*)\:(.*)@(.*)\:(.*)$/)) {
        retval = { "username": matches[1], "password": matches[2], "host": matches[3], "port": matches[4] };
      } else if (matches = cstring.match(/^(.*)@(.*)\:(.*)$/)) {
        retval = { "password": matches[1], "host": matches[2], "port": matches[3] };
      } else if (matches = cstring.match(/^(.*)\:(.*)$/)) {
        retval = { "host": matches[1], "port": matches[2] };
      } else if (matches = cstring.match(/^(.*)$/)) {
        retval = { "device": matches[1] };
      }
      return(retval);
    }
  }

  function connectModule(module, options) {
    switch (module.series) {
      case 'ds':
        module.connection = { stream: false };
        module.connection.socket = net.createConnection(module.cobject.port, module.cobject.host);
        module.connection.socket.on('open', () => { module.connection.stream = module.connection.socket; options.onopen(module); })
        module.connection.socket.on('data', (buffer) => { options.ondata(module, buffer.toString().trim()) });
        module.connection.socket.on('close', () => { options.onclose(module); });
        module.connection.socket.on('timeout', () => { module.connection.socket.end(); });
        module.connection.socket.on('error', () => { module.connection.socket = net.createConnection(module.cobject.port, module.cobject.host) });
        break;
      case 'usb':
        module.connection = { stream: false };
        module.connection.serialport = new SerialPort(module.cobject.device, { baudRate: 19200 }, (err) => {
          if (err) {
            options.onError(module);
          } else {
            module.connection.stream = module.connection.serialport;
            module.connection.parser = new ByteLength({ length: 1 });
            module.connection.serialport.pipe(module.connection.parser);
            options.onopen(module);
        
            module.connection.parser.on('data', (buffer) => {
              options.ondata(module, buffer.toString().trim());
            });

            module.connection.serialport.on('close', () => {
              module.connection.stream = false;
              options.onclose(module);
            });

            module.connection.serialport.on('error', (err) => {
              module.connection.stream = false;
              options.error(module);
            });
          }
        });
        break;
      default:
        break;
    }
  }

  return(plugin);

}
