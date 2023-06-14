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
    "protocols": [
      {
        "id": "usb",
        "statuscommand": "[",
        "statuslength": 1,
        "channels": [
          { "address": 1, "oncommand": "e", "offcommand": "o" },
          { "address": 2, "oncommand": "f", "offcommand": "p" }
        ]
      }
    ]
  },
  {
    "id": "USB-RLY08B USB-RLY16 USB-RLY16L USB-OPTO-RLY88 USB-OPTO-RLY816",
    "size": 8,
    "protocols": [
      {
        "id": "usb",
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
      }
    ]
  },
  {
    "id": "ETH002 WIFI002",
    "size": 2,
    "protocols": [
      {
        "id": "tcp",
        "statuscommand": "$",
        "statuslength": 2,
        "authenticationtoken": ",{p}",
        "channels": [
          { "address": 0, "oncommand": ":DOA,{c},0{A}", "offcommand": ":DOI,{c},0{A}" }
        ]
      }
    ]
  },
  {
    "id": "ETH044 ETH484 WIFI484",
    "size": 4,
    "protocols": [
      {
        "id": "tcp",
        "statuscommand": "$",
        "statuslength": 2,
        "authenticationtoken": ",{p}",
        "channels": [
          { "address": 0, "oncommand": ":DOA,{c},0{A}", "offcommand": ":DOI,{c},0{A}" }
        ]
      }
    ]
  },
  {
    "id": "ETH008 WIFI008",
    "size": 8,
    "protocols": [
      {
        "id": "tcp",
        "statuscommand": "$",
        "statuslength": 2,
        "authenticationtoken": ",{p}",
        "channels": [
          { "address": 0, "oncommand": ":DOA,{c},0{A}", "offcommand": ":DOI,{c},0{A}" }
        ]
      }
    ]
  },
  {
    "id": "ETH8020 WIFI8020",
    "size": 20,
    "protocols": [
      {
        "id": "tcp",
        "statuscommand": "$",
        "statuslength": 3,
        "authenticationtoken": ",{p}",
        "channels": [
          { "address": 0, "oncommand": ":DOA,{c},0{A}", "offcommand": ":DOI,{c},0{A}" }
        ]
      }
    ]
  },
  {
    "id": "DS2824",
    "size": 24,
    "protocols": [
      {
        "id": "tcp",
        "statuscommand": "ST",
        "statuslength": 24,
        "channels": [
          { "address": 0, "oncommand": ":SR {c} ON", "offcommand": ":SR {c} OFF" }
        ]
      }
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

    // If the user has configured their own devices, then add them
    // to the embedded defaults.
    options.devices = (options.devices || []).concat(DEFAULT_DEVICES);
    log.N("supported devices: %s", options.devices.reduce((a,d) => (a.concat(d.id.split(' '))), []).join(", "));

    // Process each defined module, interpolating data from the
    // specified device definition, then filter the result to eliminate
    // any broken modules.
    options.modules = options.modules.map(module => {
      try {
        return(validateModule(module, options.devices));
      } catch (e) {
        log.E("module validation failed for '%s' (%s)", module.id, e.message);
        return({});
      }
    }).filter(module => (module != {}));

    // So now we have a list of prepared, valid, modules.

    if (options.modules.length) {

      log.N("started: saving meta data for %d module%s", options.modules.length, ((options.modules.length == 1)?"":"s")); 
      options.modules.forEach(module => {
        app.debug("saving meta data for '%s'", (MODULE_ROOT + module.id));
        delta.addMeta(MODULE_ROOT + module.id,
          {
            "description": module.description,
            "displayName": "Relay module " + module.id
          });
        module.channels.forEach(c => {
          delta.addMeta(MODULE_ROOT +  module.id + "." + c.index + ".state", {
            "description": "Relay state (0=OFF, 1=ON)",
            "displayName": c.description,
            "shortName": "[" + module.id + "," + c.index + "]",
            "longName": c.description + "[" + module.id + "," + c.index + "]",
            "type": "relay"
          });
        });
      });

      /****************************************************************
       * Iterate over each module, connecting it to its relay module
       * using whatever protocol is configured and arrange for callback
       * to this common set of functions.
       */

      log.N("started: operating %d module%s", options.modules.length, ((options.modules.length == 1)?"":"s"));
      options.modules.forEach(module => {

        connectModule(module, {
          onerror: (err) => {
            log.E("%s communication error on module '%s'", module.cobject.protocol, module.id);
          },
          onopen: (module) => { 
            // Once module is open, register an action handler for every channel path
            // and issue a status request command.
            app.debug("module '%s': port %s open", module.id, module.cobject.device); 
            module.channels.forEach(ch => {
              var path = MODULE_ROOT + module.id + "." + ch.index + ".state";
              app.registerPutHandler('vessels.self', path, putHandler, plugin.id);
            });
            if (module.statuscommand) module.connection.stream.write(module.statuscommand);
          },
          ondata: (module, buffer) => {
            app.debug("module '%s': %s data received (%o)", module.id, module.cobject.protocol, buffer);
            (new Delta(app, plugin.id)).addValues(getStateUpdates(module, buffer, plugin.options.switchpath)).commit();
          },
          onclose: (module) => {
            log.E("module '%s': port %s closed", module.id, module.cobject.protocol); 
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
    var moduleId, channelIndex, relayCommand;

    if (moduleId = getModuleIdFromPath(path)) {
      if (channelIndex = getChannelIndexFromPath(path)) {
        if (relayCommand = getCommand(moduleId, channelIndex, value)) {
          module.connection.stream.write(relayCommand);
          app.debug("transmitted operating command (%s) for module %s, channel %s", relayCommand, value.moduleId, value.channelIndex);
          if (module.statuscommand !== undefined) module.connection.stream.write(module.statuscommand);
        } else {
          app.debug("cannot recover operating command for module %s, channel %s", value.moduleId, value.channelIndex);
        }
      } else {
        app.debug("error recovering channel index from path %s", path);
      }
    } else {
      app.debug("error recovering module id from path %s", path);
    }
    return({ state: 'COMPLETED', statusCode: 200 });
  }

  function getModuleIdFromPath(path) {
    var parts = path.split('.');
    return((parts.length >= 4)?parts[3]:null);
  }

  function getChannelIndexFromPath(path) {
    var parts = path.split('.');
    return((parts.length >= 5)?parts[4]:null);
  }


  /********************************************************************
   * Fettle up a module definition by normalising property values,
   * adding defaults for missing, optional, properties and copying over
   * properties from the specified device definition.
   *
   * Update <module> with:
   * - statuscommand property
   * - authenticationtoken property
   * Update each channel in <module> with:
   * - oncommand property
   * - offcommand property
   * - statusmask property
   */ 
  function validateModule(module, devices) {
    var device;

    if (module.deviceid) {
      if (device = devices.reduce((a,d) => ((d.id.split(' ').includes(module.deviceid))?d:a), null)) {
        app.debug("selected device '%s' for module '%s'", device.id, module.id);
        module.size = device.size;
        try {
          module.cobject = parseConnectionString(module.cstring);
          if (protocol = device.protocols.reduce((a,p) => ((module.cobject.protocol == p.id)?p:a), null)) {
            module.statuscommand = protocol.statuscommand;
            module.statuslength = (protocol.statuslength === undefined)?1:protocol.statuslength;
            module.authenticationtoken = protocol.authenticationtoken;
            // If the device channels array contains only one channel
            // definition with address 0, then the operating command
            // is parameterised.
            if ((protocol.channels.length == 1) && (protocol.channels[0].address == 0)) {
              for (var i = 1; i <= device.size; i++) {
                protocol.channels.push({ "oncommand": protocol.channels[0].oncommand, "offcommand": protocol.channels[0].offcommand, "address": i });
              }
            }
            module.channels.forEach(channel => {
              deviceChannel = protocol.channels.reduce((a,dc) => (((channel.address?channel.address:channel.index) == dc.address)?dc:a), null);
              if (deviceChannel) {
                channel.oncommand = deviceChannel.oncommand;
                channel.offcommand = deviceChannel.offcommand;
                channel.statusmask = (deviceChannel.statusmask !== undefined)?deviceChannel.statusmask:(1 << (deviceChannel.address - 1));
              } else {
                throw new Error("module has an invalid definition for channel");
              }        
            });
          } else {
            throw new Error("module has an invalid cstring (protocol not supported)");
          }
        } catch (e) {
          throw new Error("module has an invalid cstring (" + module.cstring + ")");
        }
      } else {
        throw new Error(sprintf("module '%s' has an invalid deviceid", module.id));
      }
    } else {
      throw new Error(sprintf("module '%s' has no deviceid property", module.id));
    }
    return(module);
  
    function parseConnectionString(cstring) {
      var retval = null;

      if (matches = cstring.match(/^tcp\:(.*)\:(.*)@(.*)\:(.*)$/)) {
        retval = { "protocol": "tcp", "username": matches[1], "password": matches[2], "host": matches[3], "port": matches[4] };
      } else if (matches = cstring.match(/^tcp\:(.*)@(.*)\:(.*)$/)) {
        retval = { "protocol": "tcp", "password": matches[1], "host": matches[2], "port": matches[3] };
      } else if (matches = cstring.match(/^tcp\:(.*)\:(.*)$/)) {
        retval = { "protocol": "tcp", "host": matches[1], "port": matches[2] };
      } else if (matches = cstring.match(/^usb\:(.*)$/)) {
        retval = { "protocol": "usb", "device": matches[1] };
      }
      return(retval);
    }
  }

  /********************************************************************
   * Attempts to connect <module> to its defined and configured
   * hardware device. <module> must have been validated and prepared
   * for use by a prior call to validateModuleDefinition().
   *
   * <module> is updated with a module.connection object propert which
   * is used to hold configuration and state information relating the
   * connected module. Pretty much everything that goes on here is
   * asynchronous in character.
   *
   * The <options> object should be used to define a number of
   * callbacks:
   *
   * onopen is required and defines a function which will be called
   * with <module> when a connection is successfully opened and
   * should be used to register the now functioning module with Signal
   * K by subscribing relay state change functions to each of the
   * module channel paths.
   *
   * onclose is optional and defines a function which will be called
   * with <module> if a connection spontaineously closes and should be
   * used to de-register the now non-functioning module from Signal K
   * by unsubscribing trigger deltas.
   *
   * onupdate will be called with explanatory messages as connections
   * are progressed.
   *
   * onerror will be called with diagnostic messages if connection
   * fails. 
   *
   * @param module - the module definition to be processed.
   * @param options - various callbacks.
   */

  function connectModule(module, options) {
    switch (module.cobject.protocol) {
      case 'tcp':
        module.connection = { stream: false };
        module.connection.socket = new net.createConnection(module.cobject.port, module.cobject.host, () => {
          module.connection.socket.on('open', () => {
            options.onopen(module);

            module.connection.socket.on('data', (buffer) => {
              app.debug("TCP data received from " + module.id + " [" + buffer.toString() + "]");
              options.ondata(module, buffer)
            });

            module.connection.socket.on('close', () => {
              app.debug("TCP socket closed for " + module.id);
              module.connection.stream = false;
              options.onclose(module);
            });

            module.connection.socket.on('error', () => {
                if (options && options.onerror) options.onerror("TCP socket ended for " + module.id);
            });
          });
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

  /********************************************************************
   * Processes a <device> definition and returns the relay control
   * command that is specified for for switching <channel> to <state>
   * using * the protocol specified in the <connectionParameters>
   * "protocol" property.
   *  
   * @param device - device definition from which to pull the command.
   * @param protocol - the protocol to use for communication with
   * device.
   * @param channel - the channel to be operated.
   * @param state - the state to which the relay should be set (0 or
   * 1).
   * @return - the required command string or null if command recovery
   * fails.
   */
  function getCommand(module, channelId, state) {
    var retval = null;
    var channel = module.channels.reduce((a,c) => ((c.index == channelId)?c:a), null);
    if (channel) {
      retval = (state)?channel.oncommand:channel.offcommand;
      if (retval) {
        retval = retval.replace('{A}', module.authenticationtoken);
        retval = retval.replace("{c}", channel.index);
        retval = retval.replace('{C}', String.fromCharCode(parseInt(channel.index, 10)));
        retval = retval.replace("{p}", module.cobject.password);
        retval = retval.replace("{u}", channel.index);
        retval = retval.replace(/\\(\d\d\d)/gi, (match) => String.fromCharCode(parseInt(match, 8)));
        retval = retval.replace(/\\0x(\d\d)/gi, (match) => String.fromCharCode(parseInt(match, 16)));
      }
    }
    return(retval);
  }

  /********************************************************************
   * Return an array of state updates for <module> derived from
   * processing <buffer> which is assumed to contain a status message
   * received from the relay device associated with <module>.
   */

  function getStateUpdates(module, buffer, switchpath) {
    var moduleState = null, channelState, retval = null;
    if (switchpath) {
      switch (module.cobject.protocol) {
        case "tcp":
          if ((module.size <= 8) && (module.statuslength == buffer.length)) moduleState = (buffer.readUInt16BE(0) >> 8);
          if ((module.size == 20) && (module.statuslength == buffer.length)) moduleState = (0 | (buffer.readUInt(0)) | (buffer.readUInt(1) << 8) | (buffer.readUInt(2) << 16));
          break;
        case "usb":
          if ((module.size <= 8) && (module.statuslength == buffer.length)) moduleState = buffer.readUInt8(0);
          break;
        default:
          break;
      }
      if (moduleState !== null) {
        retval = [];
        module.channels.forEach(channel => {
          channelState = (moduleState & channel.statusmask)?1:0;
          retval.push({
            "path": switchpath.replace('{m}', module.id).replace('{c}', channel.index) + ".state",
            "value": channelState
          });
        });
      }
    }
    return(retval);
  }

  return(plugin);

}
