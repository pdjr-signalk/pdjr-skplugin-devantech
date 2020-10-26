# signalk-devantech

Signal K interface to the [Devantech](https://www.devantech.co.uk) range of general purpose relay modules.

This project implements a plugin for the [Signal K Node server](https://github.com/SignalK/signalk-server-node).

The [Signal K data model](http://signalk.org/specification/1.0.0/doc/data_model.html) and
[Alarm, alert and notification handling](http://signalk.org/specification/1.0.0/doc/notifications.html) sections of the Signal K documentation may provide helpful orientation.

__signalk-devantech__ implements a reporting and control interface for
multi-channel relay devices manufactured by the UK company Devantech. The supplied configuration file includes definitions for most of the Devantech product range including devices that are operated over USB, WiFi and wired ethernet.

The plugin accepts relay operating commands over a *control channel*
which can be either a Signal K notification path or a Unix domain
socket (IPC).

__signalk-devantech__ was designed to operate alongside the
[signalk-switchbank](https://github.com/preeve9534/signalk-switchbank#readme) plugin which implements a compatible and comprehensive control logic.

Devantech Ltd kindly supported the development of this plugin by making some of its relay devices available to the author for evaluation and testing.

## Overview

This discussion uses the term *device* to refer to a supported product available from Devantech and *module* to refer to a specific *device* that has been installed by the user for operation by __signalk-devantech__.

__signalk-devantech__ relies on a configuration file which:

1. Identifies the control channel on which the plugin should listen for relay operating *commands*.

2. Defines the devices the plugin is able to operate through a collection of *device definitions* which enumerate the physical characteristics of a device, its operating protocol and the commands necessary to operate it.

3. Specifies the modules which the user wishes the plugin to operate through a collection of *module definitions* which identify the module device type, map a Signal K channel onto each device relay and name each channel for documentary and reporting purposes.

The default configuration file includes an expandable set of device definitions for products in Devantech's USB, ETH and WIFI model ranges.

For each configured module, __signalk-devantech__ performs three distinct tasks: firstly, it builds a Signal K path for each module channel and decorates the path with some documentary meta data; secondly it maintains state information for each path which reflects the current relay state; and finally it accepts commands from the plugin control channel and uses these to operate relays on attached devices.

### Signal K data paths and meta information

By default, a relay device is represented in Signal K by a collection of paths with the general pattern 'electrical.switches.bank.*m*.*c*', where *m* is an arbitrary module identifier and *c* is a natural number indexing a channel within a module. This structure echoes the Signal K representation of NMEA switch banks.

When __signalk-devantech__ first starts it creates appropriate Signal K paths from module definitions in its configuration file and adds meta property to each path describing the relay bank channel.

### Relay state information

The state value of each Signal K path is set when the module starts and after each relay update operation. State values in Signal K are only ever set from device status reports and hence should always reflect the actual physical state of each relay.

### Command processing
 
A relay channel is operated by sending __signalk-devantech__ a string representation of a JSON *control-message* of the form:

    { "moduleid": "*m*", "channelid": *c*, "state": s }

where *m* and *c* have the meaning discussed above and *s* is the value 0 or 1 (meaning OFF or ON respectively).

Within Signal K, the simplest way of delivering a *control-message* is via a notification stream and in this case the control message is should be the value of the notification's description property.

When the plugin receives a control-message it attempts to convert it
into a JSON object using the JSON.parse() function and then validates
the request against its configuration.
If all is good it immediately issues an appropriate operating command
to the module selected by *m*.

## System requirements

__signalk-devantech__ has no special installation requirements.

## Installation

Download and install __signalk-devantech__ using the _Appstore_ link in your
Signal K Node server console.
The plugin can also be obtained from the 
[project homepage](https://github.com/preeve9534/signalk-devantech)
and installed using
[these instructions](https://github.com/SignalK/signalk-server-node/blob/master/SERVERPLUGINS.md).

## Configuration

__signalk-devantech__ can be configured from within the Signal K
console by navigating to _Server->Plugin config_ and selecting the
_Devantech interface_ tab.
If you prefer, the configuration file ```devantech.json``` can be
edited directly using a text editor.

The plugin configuration file has the following general structure.

```
{
  "enabled": false,
  "enableLogging": false,
  "properties": {
    "controlchannel": "notification:notifications.switchlogic.command",
    "switchpath": "electrical.switches.bank.{m}.{c}",
    "modules": [
      ** MODULE DEFINITIONS **
    ],
    "devices": [
      ** DEVICE DEFINITIONS **
    ]
  }
}
```

If you are using a relay module from Devantech, then most likely the
only configuration required will be to define the modules connected to
your system and you can skip to the *Module definitions* section.

### Global properties

The __controlchannel__ property value introduces a configuration string
which sets up the channel on which the plugin will listen for relay
operating commands.
The configuration string must have the form "*channel-type*__:__*channel-id*" with the following value constraints.

| *channel-type*   | *channel-id*                                               |
|:-----------------|:-----------------------------------------------------------|
| __notification__ | A path in the Signal K "notifications...." tree.           |
| __ipc__          | The pathname of a Unix domain socket.                      |

The property value defaults to "notification:notifications.switchlogic.command".

The __switchpath__ property value specifies a pattern for the Signal K
paths that will be used by the plugin to represent its configured relay
modules.
The default value of "electrical.switches.bank.{m}.{c}" can probably be
left untouched, but if you need to change it, then any path you supply
must include the tokens '{m}' and '{c}' as placeholders which the
plugin will interpolate with module-id and channel-id values for each
connected module.

### Module definitions

The __modules__ property value is an array of module definitions each
of which describes a relay device you wish the plugin to operate. For example:
```
    "modules": [
      {
        "id": "eth0",
        "description": "ETH484 evaluation module #223-1677",
        "deviceid": "ETH484",
        "devicecstring": "tcp:password@192.168.1.190:17494",
        "channels": [
          { "index": 1, "description": "ETH relay 1" },
          { "index": 2, "description": "ETH relay 2" },
          { "index": 3, "description": "ETH relay 3" },
          { "index": 4, "description": "ETH relay 4" }
        ]
      }
      {
        "id": "usb0",
        "description": "USB-RLY02 evaluation module #117-556",
        "deviceid": "USB-RLY02",
        "devicecstring": "usb:/dev/ttyACM0",
        "channels": [
          { "index": 1, "description": "USB Relay 1" },
          { "index": 2, "description": "USB Relay 2" }
        ]
      }
    ]
```

Each module definition has the following properties.

The __id__ property value must supply a unique identifier for the module
being defined. This value will be used as part of the Signal K path
used to report relay states (by replacing the '{m}' token in the
__switchpath__ property value discussed above) and will also be used in
status and error messaging.
This value is required and has no default.

The __description__ property value can be used to supply some
documentary text.
This value is optional and defaults to the empty string.

The __deviceid__ property value specifies what type of physical device
is being used to implement this module by providing a device identifier (see the *Device definitions* section below for more detail).
This value is required and has no default.

The __devicecstring__ property value supplies a connection string that
tells the plugin how to connect to the physical device.
There are two styles of value: one describes a USB connection and the other an ethernet connection (supporting Devantech's wired and wireless devices).

A USB connection string has the form "__usb:__*device-path*" where
*device-path* specifies the serial device representing the physical
port to which the associated device is connected.
A typical value for a USB __devicecstring__ might be "usb:/dev/ttyACM0".

An ethernet connection string has the form   "__eth:__[*password*__@__]*address*__:__*port*" where *address* is the IP address or hostname assigned to the associated device, *port* is the port number on which it provides service and *password* is the optional password required to operate the device. All of these values are defined when you configure the Devantech relay bank for first use: consult the appropriate Devantech user guide for more information. 

A connection string must be specified and has no default.

The __channels__ property introduces an array of channel definitions
each of which describes a relay channel.

The required __index__ property defines the relay module channel to which the channel definition relates. This value is used by the plugin to overwrite the '{c}' token in the __switchpath__ property discussed earlier and is also used in status and error reporting.

The optional __address__ property value defines the physical channel on the remote device with which this channel is associated. If this property is omitted, then the plugin will use the value of the __index__ property as the channel address.
 
The __description__ property value supplies some narrative that is
used in status and error reporting and, more importantly, is used 
to decorate the module switch bank channel with meta information that
can be picked up by other Signal K processes.

### Device definitions

The __devices__ property defines an array of *device definitions*, each
of which describes the physical and interfacing characteristics of a
supported relay devices.
A device must be defined here before it can be configured for use in a
module definition.
The plugin installation includes device definitions for all of the
Devantech relay modules that were available at the time of release, but
if you need to add an unsupported device, then read-on...

Each device definition has the following properties.

The _id_ property value supplies string containing a list of
space-separated identifiers for each of the deviceis to which the
definition applies.
Typically these identifiers should be the device manufacturer's model
number.
A value is required and there is no default.

The __size__ property value specifies the number of relay channels
supported by the device.
A value is required and there is no default.

The __protocols__ array property introduces a list of protocol
definitions each of which defines a communication protocol supported by
the device.
For most devices you will only need to specify one.
Each protocol definition has the following properties.

The __id__ property value specifies the protocol type being defined and
must be one of 'usb' or 'tcp'.
A value is required and there is no default.

The __statuscommand__ property value supplies the string that must be
transmitted to the device to elicit a status report.
A value is required and there is no default.

The __statuscommand__ property value defines the number of bytes which
constitute the status report message transmitted by the device in
response to a status command.
A value is required and the default is 1.

The __authenticationtoken__ property value specifies the format for an
authentication token '{A}' which can be used when defining operating
commands (see below).
Some Devantech protocols require that a device password is accompanied
by some identifying character sequence and the format of that sequence
can be specified here in terms of any username {u} and password {p}
tokens.
For example, one of the Devantech TCP protocols can be password
protected and passwords are introduced into commands by preceeding them
with a 'y' character giving an authentication token format of 'y{p}'.
A value is optional and there is no default.

The __channels__ array property introduces a list of channel
definitions each of which specifies the commands required to operate a
particular relay on the device.
Relays are identified by an ordinal address in the range 1..__size__
and each channel can be defined explicitly, but if there is a common
format for commands that applies to all channels, then a pattern can be
defined for the fake channel with address 0 which will be elaborated
for each of the real channels on the device.

Each channel definition has the following properties.

The __address__ property value gives the ordinal number of the relay
channel that is being defined (or 0 for a generic definition).
A value is required and the default is 0.

The __oncommand__ property introduces a string that should be
transmitted to the device to turn the relay identified by __address__
ON.

The __offcommand__ property introduces a string that should be
transmitted to the device to turn the relay identified by __address__
OFF.

Both __oncommand__ and __offcommand__ property values should be simple
JSON formatted strings and can contain embedded escape sequences.
Additionally, the the following wildcard tokens will be substituted
with real values before string transmission.

| Token  | Replacement value                                                        |
|:-------|:-------------------------------------------------------------------------|
| {c}    | The ASCII encoded address of the channel being processed.                |
| {C}    | The binary encoded address of the channel being processed.               |
| {A}    | The value of any defined authentication token (after token replacement). | 
| {u}    | The value of any defined module userid.                                  |
| {p}    | The value of any defined module password.                                |

The __statusmask__ property value can be used to introduce a number
that will be bitwise AND-ed with channel state reports received from
the device so as to obtain a status value for the channel.
If no value is supplied then the plugin will compute a mas value from
the channel __address__ using the formula (1 << (*address* - 1)).
Not requires and the internal default is the computed value.

## Usage

__signalk-devantech__ has no special run-time usage requirement.

You can monitor the plugin's manipulation of the Signal K data tree by
reviewing the server state model in a web browser.

Status and error messages are written to the Signal K server logs.

## Supported relay modules

__signalk-devantech__ supports relay modules manufactured by:

    Devantech Ltd\
    Maurice Gaymer Road\
    Attleborough\
    NR17 2QZ\
    England\

    Telephone: +44 (0)1953 457387\
    Fax: +44 (0)1953 459793

    Website: [www.robot-electronics.co.uk](https://www.robot-electronics.co.uk/)

The following table lists the relay modules against which the plugin
implementation was developed.

|Relay module   |No of relays|Connection|Protocols|
|:--------------|:----------:|:--------:|:-------:|
|USB-RLY02-SN   |2           |USB       |usb      |
|USB-RLY02      |2           |USB       |usb      |
|USB-RLY08B     |8           |USB       |usb      |
|USB-RLY82      |8           |USB       |usb      |
|USB-RLY16      |16          |USB       |usb      |
|USB-RLY16L     |16          |USB       |usb      |
|USB-OPTO-RLY88 |8           |USB       |usb      |
|USB-RLY816     |16          |USB       |usb      |

## Author

Paul Reeve <preeve@pdjr.eu>\
October 2020
<!--stackedit_data:
eyJoaXN0b3J5IjpbLTM1MzQ0MDY1MywxNDA4ODM0ODMwLDE3ND
YyNTQ3Nl19
-->