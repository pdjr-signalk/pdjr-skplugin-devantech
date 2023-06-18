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
const PLUGIN_UISCHEMA_FILE = {};

const MODULE_ROOT = "electrical.switches.bank.";
const DEFAULT_DEVICES = [
  {
    "id": "USB-RLY02-SN USB-RLY02 USB-RLY82",
    "size": 2,
    "protocol": "usb",
    "statuscommand": "[",
    "statuslength": 1,
    "channels": [
      { "address": 1, "oncommand": "e", "offcommand": "o" },
      { "address": 2, "oncommand": "f", "offcommand": "p" }
    ]
  },
  {
    "id": "USB-RLY08B USB-RLY16 USB-RLY16L USB-OPTO-RLY88 USB-OPTO-RLY816",
    "size": 8,
    "protocol": "usb",
    "statuscommand": "[",
    "statuslength": 1,
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
    "size": 24,
    "protocol": "tcp",
    "statuscommand": "ST",
    "channels": [
      { "address": 0, "oncommand": "SR {c} ON", "offcommand": "SR {c} OFF" }
    ]
  }
];

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;
  plugin.schema = PLUGIN_SCHEMA;
  plugin.uiSchema = {};
  plugin.options = null;

  const delta = new Delta(app, plugin.id);
  const log = new Log(plugin.id, { "ncallback": app.setPluginStatus, "ecallback": app.setPluginError });

  plugin.start = function(options) {
  
    // Context-free event handlers need access to the plugin
    // configuration options, so we elevate them to the plugin global
    // namespace. 
    options = (plugin.options = options);

    // If the user has configured their own devices, then add them
    // to the embedded defaults.
    options.devices = (options.devices || []).concat(DEFAULT_DEVICES);
    app.debug("supported devices: %s", options.devices.reduce((a,d) => (a.concat(d.id.split(' '))), []).join(", "));

    // Process each defined module, interpolating data from the
    // specified device definition, then filter the result to eliminate
    // any broken modules.
    options.modules = options.modules
      .map(module => elaborateModuleConfiguration(module, options.devices))
      .filter(module => (module != {}));

    // So now we have a list of prepared, valid, modules.

    if (options.modules.length) {

      log.N("started: saving meta data for %d module%s", options.modules.length, ((options.modules.length == 1)?"":"s")); 
      options.modules.forEach(module => {
        app.debug("saving meta data for '%s'", module.id);
        var path = (MODULE_ROOT + module.id);
        var meta = { "description": module.description, "displayName": "Relay module " + module.id };
        delta.addMeta(path, meta);
        module.channels.forEach(c => {
          path = (MODULE_ROOT +  module.id + "." + c.index + ".state");
          meta = {
            "description": "Relay state (0=OFF, 1=ON)",
            "displayName": c.description,
            "shortName": "[" + module.id + "," + c.index + "]",
            "longName": c.description + " [" + module.id + "," + c.index + "]",
            "type": "relay"
          };
          delta.addMeta(path, meta);
        });
      });
      delta.commit().clear();

      /****************************************************************
       * Iterate over each module, connecting it to its relay module
       * using whatever protocol is configured and arrange for callback
       * to this common set of functions.
       */

      log.N("started: operating %d module%s", options.modules.length, ((options.modules.length == 1)?"":"s"));
      options.modules.forEach(module => {
        app.debug("module %s: trying to connect... (%s)", module.id, module.cstring);

        connectModule(module, {
          onerror: (err) => {
            app.debug("module %s: communication error (%s)", module.id, err, false);
          },
          onopen: (module) => { 
            // Once module is open, register an action handler for every channel path
            // and issue a status request command.
            app.debug("module %s: ...connected", module.id, false); 
            module.connection.stream.write(module.statuscommand);
            module.channels.forEach(ch => {
              var path = MODULE_ROOT + module.id + "." + ch.index + ".state";
              app.debug("registering PUT handler on '%s'", path);
              app.registerPutHandler('vessels.self', path, putHandler, plugin.id);
            });
            // And register a status listener for the module
            //if (module.cstring.substr(0,4) == 'tcp:') {
              //createStatusListener(module);
            //}
          },
          ondata: (module, status) => {
            app.debug("received '%s'", status);
            var status, delta, path, value;
            switch (module.protocol) {
              case "usb":
                break;
              case "tcp":
                if (status.length == 32) {
                  delta = new Delta(app, plugin.id);
                  for (var i = 0; ((i < status.length) && (i < module.size)); i++) {
                    path = MODULE_ROOT + module.id + "." + (i + 1) + ".state";
                    value = (status.charAt(i) == '0')?0:1;
                    delta.addValue(path, value);
                  }
                  app.debug("issuing delta");
                  delta.commit().clear();
                  delete delta;
                } else {
                  app.debug("what is this %s", status);
                }

                break;
              default:
                break;
            }
          },
          onclose: (module) => {
            app.debug("module '%s': port %s closed", module.id, module.cobject.protocol); 
          }
        });
      });
    } else {
      log.W("stopped: there are no usable module definitions.");
    }
  }

  plugin.stop = function() {
    unsubscribes.forEach(f => f());
    unsubscribes = [];
  }

  function putHandler(context, path, value, callback) {
    var moduleId, module, channelIndex, channel, relayCommand;
    var retval = { "state": "COMPLETED", "statusCode": 400 };
    app.debug("Handling...");
    if (moduleId = getModuleIdFromPath(path)) {
      if (module = getModuleFromModuleId(moduleId)) {
        if (channelIndex = getChannelIndexFromPath(path)) {
          if (channel = module.channels.reduce((a,c) => ((c.index == channelIndex)?c:a), null)) {
            relayCommand = ((value)?channel.oncommand:channel.offcommand) + "\n";
            module.connection.stream.write(relayCommand);
            retval.statusCode = 200;
            log.N("transmitting '%s' to module '%s'", relayCommand, moduleId);
          } else {
            retval.message = "error recovering channel configuration";
          }
        } else {
          retval.message = "error recovering channel index from path";
        }
      } else {
        retval.message = "error recovering module configuration";
      }
    } else {
      retval.message = "error recovering module id from path";
    }
    return(retval);
  }

  function getModuleFromModuleId(moduleId) {
    return(plugin.options.modules.reduce((a,m) => ((m.id == moduleId)?m:0), null));
  }

  function getModuleIdFromPath(path) {
    var parts = path.split('.');
    return((parts.length >= 4)?parts[3]:null);
  }

  function getChannelIndexFromPath(path) {
    var parts = path.split('.');
    return((parts.length >= 5)?parts[4]:null);
  }

  function elaborateModuleConfiguration(module, devices) {
    var device, oncommand, offcommand;
    var retval = {};

    if (module.deviceid) {
      if (device = devices.reduce((a,d) => ((d.id.split(' ').includes(module.deviceid))?d:a), null)) {
        module.size = device.size;
        module.protocol = device.protocol;
        module.statuscommand = device.statuscommand;
        module.statuslength = device.statuslength;
        module.authenticationtoken = device.authenticationtoken;
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
    switch (module.protocol) {
      case 'tcp':
        module.connection = { stream: false };
        module.connection.socket = new net.createConnection(module.cobject.port, module.cobject.host, () => {
          module.connection.stream = module.connection.socket;
          options.onopen(module);

          module.connection.socket.on('data', (buffer) => { options.ondata(module, buffer.toString().trim()) });
          module.connection.socket.on('close', () => { module.connection.socket.close(); options.onclose(module); });
          module.connection.socket.on('timeout', () => { module.connection.socket.close(); });
          module.connection.socket.on('error', () => { options.onerror(module); });
        });
        break;
      case 'usb':
        module.connection = { stream: false };
        module.connection.serialport = new SerialPort(module.cobject.device, { baudRate: 19200 }, (err) => {
          if (err) {
            options.onerror(err);
          }
        });
        module.connection.serialport.on('open', () => {
          module.connection.stream = module.connection.serialport;
          module.connection.parser = new ByteLength({ length: 1 });
          module.connection.serialport.pipe(module.connection.parser);
          options.onopen(module);
          module.connection.parser.on('data', (buffer) => {
            options.ondata(module, buffer);
          });
          module.connection.serialport.on('close', () => {
            module.connection.stream = false;
            options.onclose(module);
          });
          module.connection.serialport.on('error', (err) => {
            module.connection.stream = false;
            options.onerror(err);
          });
        });
        break;
      default:
        break;
    }
  }

  return(plugin);

}
