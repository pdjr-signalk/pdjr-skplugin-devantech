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
const { v4: uuidv4 } = require('uuid');

const PLUGIN_ID = "devantech";
const PLUGIN_NAME = "pdjr-skplugin-devantech";
const PLUGIN_DESCRIPTION = "Signal K interface to the Devantech range of general-purpose relay modules";
const PLUGIN_SCHEMA_FILE = __dirname + "/schema.json";
const PLUGIN_UISCHEMA_FILE = __dirname + "/uischema.json";

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = PLUGIN_DESCRIPTION;
  plugin.schema = {};
  plugin.uiSchema = {};
  plugin.options = null;

  const delta = new Delta(app, plugin.id);
  const log = new Log(plugin.id, { "ncallback": app.setPluginStatus, "ecallback": app.setPluginError });

  plugin.start = function(options) {
    if (Object.keys(options).length == 0) {
      options = plugin.schema.default;
      log.W("using default configuration");
    }

    /******************************************************************
     * Filter the module definitions in <options.modules>, eliminating
     * those module definitions that do not select a valid device and
     * those which cannot be made usable by validateModule().
     */

    plugin.options.modules = plugin.options.modules.reduce((a,m)  => {
      try { a.push(validateModule(m, plugin.options.devices)); } catch(e) { log.E(e); }
      return(a);
    }, []);

    /******************************************************************
     * So now we have a, possibly empty, list of prepared, validated,
     * modules.
     */

    if (plugin.options.modules.length) {
      log.N("started: loading meta data for %s", options.modules.map(module => module.id).join(", "));
 
      plugin.options.modules.forEach(module => {
        module.channels.forEach(c => {
          delta.addM.push({
                key: plugin.options.switchpath.replace('{m}', module.id).replace('{c}', c.index) + ".state",
                description: "Relay state (0=OFF, 1=ON)",
                displayName: c.description,
                longName: c.description + " (bank " + module.id + ", channel " + c.index + ")",
                shortName: "[" + module.id + "," + c.index + "]",
                type: c.type
              });
            });
          });
          if (metadata.length) {
            var client = new net.Socket();
            client.connect(options.metainjectorfifo);
            client.on('connect', () => {
              log.N("sending %d metadata keys to injector service at '%s'", metadata.length, options.metainjectorfifo);
              client.write(JSON.stringify(metadata));
              client.end();
            });
          }
        } else {
          log.E("meta injector FIFO (%s) does not exist", options.metainjectorfifo);
        }
      }

      /****************************************************************
       * Iterate over each module, connecting it to its relay module
       * using whatever protocol is configured and arrange for callback
       * to this common set of functions.
       */

      plugin.options.modules.forEach(module => {

        connectModule(module, {
          onerror: (err) => {
            app.debug("module %s: %s communication error (%s)", module.id, module.cobject.protocol, err);
          },
          onopen: (module) => { 
            // Once module is open, register an action handler for every channel path
            // and issue a status request command.
            app.debug("module %s: port %s open", module.id, module.cobject.device); 
            module.channels.forEach(ch => {
              var path = plugin.options.switchpath.replace('{m}', module.id).replace('{c}', ch.index) + ".state";
              app.registerPutHandler('vessels.self', path, actionHandler, plugin.id);
            });
            if (module.statuscommand !== undefined) module.connection.stream.write(module.statuscommand);
          },
          ondata: (module, buffer) => {
            app.debug("module %s: %s data received (%o)", module.id, module.cobject.protocol, buffer);
            (new Delta(app, plugin.id)).addValues(getStateUpdates(module, buffer, plugin.options.switchpath)).commit();
          },
          onclose: (module) => {
            app.debug("module %s: %s port closed", module.id, module.cobject.protocol); 
          }
        });
      });
    } else {
      log.W("there are no usable module definitions.");
    }
  }

  plugin.stop = function() {
    unsubscribes.forEach(f => f());
    unsubscribes = [];
  }

  function actionHandler(context, path, value, callback) {
    var module = getModuleFromPath(path);
    if (module) {
      var relaycommand = getCommand(getModuleFromPath(path), getChannelIdFromPath(path), value);
      if (relaycommand) {
        module.connection.stream.write(relaycommand);
        app.debug("transmitted operating command (%s) for module %s, channel %s", relaycommand, value.moduleid, value.channelid);
        if (module.statuscommand !== undefined) module.connection.stream.write(module.statuscommand);
      } else {
        log.E("cannot recover operating command for module %s, channel %s", value.moduleid, value.channelid);
      }
    }
    return({ state: 'COMPLETED', statusCode: 200 });
  }

  function getModuleFromPath(path) {
    var parts = path.split('.') || [];
    return(plugin.options.modules.reduce((a,m) => ((m.id == parts[3])?m:a), null));
  }

  function getChannelIdFromPath(path) {
    var parts = path.split('.') || [];
    return(parts[4]);
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
      if (device = options.devices.reduce((a,d) => ((d.id.split(' ').includes(module.deviceid))?d:a), null)) {
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
              for (var i = 0; i <= device.size; i++) {
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
                throw new Error(sprintf("module '%s' has an invalid definition for channel %d", module.id, channel.index));
              }        
            });
          } else {
            throw new Error(sprintf("module %s has an invalid cstring (protocol not supported)", module.id));
          }
        } catch (e) {
          throw new Error(sprintf("module '%s' had an invalid cstring", moduleid));
        }
      } else {
        throw new Error(sprintf("module '%s' has an invalid deviceid", module.id));
      }
    } else {
      throw new Error(sprintf("module '%s' has no deviceid property", module.id));
    }
    return(module);
  }


  
  function validateModule(module, options) {
    var device, protocol, deviceChannel;
    if (module.deviceid) {
      if (device = options.devices.reduce((a,d) => ((d.id.split(' ').includes(module.deviceid))?d:a), null)) {
        module.size = device.size;
        if (module.cobject = parseConnectionString(module.devicecstring)) {
          if (protocol = device.protocols.reduce((a,p) => ((module.cobject.protocol == p.id)?p:a), null)) {
            module.statuscommand = protocol.statuscommand;
            module.statuslength = (protocol.statuslength === undefined)?1:protocol.statuslength;
            module.authenticationtoken = protocol.authenticationtoken;
            if ((protocol.channels.length == 1) && (protocol.channels[0].address == 0)) {
              for (var i = 0; i <= device.size; i++) {
                var blob = { "oncommand": protocol.channels[0].oncommand, "offcommand": protocol.channels[0].offcommand, "address": i };
                protocol.channels.push(blob);
              }
            }
            module.channels.forEach(channel => {
              deviceChannel = protocol.channels.reduce((a,dc) => (((channel.address?channel.address:channel.index) == dc.address)?dc:a), null);
              if (deviceChannel) {
                channel.oncommand = deviceChannel.oncommand;
                channel.offcommand = deviceChannel.offcommand;
                channel.statusmask = (deviceChannel.statusmask !== undefined)?deviceChannel.statusmask:(1 << (deviceChannel.address - 1));
              } else {
                throw("invalid channel definition (" + channel.index + ")");
              }        
            });
          } else {
            throw("protocol specified in connection string is not supported by specified device (" + module.cobject.protocol + ")");
          }
        } else {
          throw("module connection string could not be parsed (" + module.devicecstring + ")");
        }
      } else {
        throw("module device id does not specify a defined device (" + module.deviceid + ")");
      }
    } else {
      throw("module definition must include a device id");
    }
    return(module);
  
    function parseConnectionString(cstring) {
      var retval = null;
      var matches, username = undefined, password = undefined, protocol = undefined, device = undefined, port = undefined;
      
      [ protocol, cstring, port ] = cstring.split(':').map(v => v.trim());
      switch (protocol) {
        case "tcp":
          if (cstring.includes('@')) [ password, cstring ] = cstring.split('@', 2).map(v => v.trim());
          retval = { "protocol": "tcp", "host": cstring, "port": port, "password": password };
          break;
        case "usb":
          retval = { "protocol": "usb", "device": cstring };
          break;
        default:
          break;
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
          if (options && options.onupdate) options.onupdate("TCP socket opened for module " + module.id);
          module.connection.stream = module.connection.socket;
          module.connection.socket.on('data', (buffer) => {
            if (options && options.onupdate) options.onupdate("TCP data received from " + module.id + " [" + buffer.toString() + "]");
            if (options && options.ondata) options.ondata(module, buffer)
          });
          module.connection.socket.on('close', () => {
            if (options && options.onerror) options.onerror("TCP socket closed for " + module.id);
            module.connection.stream = false;
            if (options && options.onclose) options.onclose(module);
          });
          module.connection.socket.on('end', () => {
            if (options && options.onerror) options.onerror("TCP socket ended for " + module.id);
          });
          if (options && options.onopen) options.onopen(module);
        });
        break;
      case 'usb':
        module.connection = { stream: false };
        module.connection.serialport = new SerialPort(module.cobject.device, { baudRate: 19200 }, (err) => {
          if (err) {
            options.onerror(module);
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
          module.connection.serialport.on('error', () => {
            module.connection.stream = false;
            options.onerror(module);
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

  function getCommand(module, channelid, state) {
    var retval = null;
    var channel = module.channels.reduce((a,c) => ((c.index == channelid)?c:a), null);
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
