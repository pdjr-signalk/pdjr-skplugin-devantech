# pdjr-skplugin-devantech

Signal K interface to the
[Devantech](https://www.devantech.co.uk)
DS range of general-purpose relay modules.

## Background

Recently I had an idea for a project that required multi-channel remote
switching over Ethernet.
For consistency of experience and expectation I wanted to use devices
that as far as possible behaved in a similar way to my existing NMEA
2000 switchbank relays.

The Devantec DS series of Ethernet relay modules caught my eye because
they can be configured to autonomously transmit status reports in a way
which can mimic the familiar behaviour of NMEA compliant switchbanks.

This plugin provides an interface between Signal K's electrical switch
data model and Devantec DS relay modules and was developed and tested
with
[this product](https://www.robot-electronics.co.uk/catalog/product/view/id/159/s/ds2824-24-x-16a-ethernet-relay/category/7/)
kindly supplied for evaluation by:

Devantech Ltd\
Maurice Gaymer Road\
Attleborough\
NR17 2QZ\
England

Telephone: +44 (0)1953 457387\
Fax: +44 (0)1953 459793

Website: [www.robot-electronics.co.uk](https://www.robot-electronics.co.uk/)

## Description

**pdjr-skplugin-devantech** implements a control interface for
multi-channel Devantech DS-series Ethernet relay devices.

The plugin listens on a specified TCP port for status reports from
configured DS devices and uses the received data to update Signal K
switch paths associated with the transmitting device.

Receipt of status notifications from a DS device causes the plugin to
establish and maintain a persistent TCP connection to the remote
device that allows it to operate relays in response to Signal K PUT
requests on the associated switch channels.

This operating strategy is resilient to network outage and allows
*ad-hoc* connection of DS devices.

In addition to the relay control service the plugin also provides a
mechanism for decorating Signal K's data hierarchy with user supplied
meta-data that documents a DS device in a meaningful way and allows
relay channels to be described in terms of their function or
application.

## Configuration

### Configuring a DS module for use with this plugin

1. If not already done, configure the DS device's IP address and
   control port number. Make a note of these values so that they can be
   used in the 'cstring' property of the module's plugin configuration
   entry.

2. Event Notifications. 'Triggers' should identify all the relays on
   the device and also the virtual relay R32. 'Target IP' should be set
   to the IP address of the Signal K host and 'Target Port' to the same
   value as the 'statusListenerPort' property in the plugin 
   configuration. Set 'TCP/IP Timeout' to 5000.

3. Timers. Select 'Counter No.' 1 and set 'Counter Input' to 'T1' and
   'Reset Input' to 'C1>9'.

4. Relays. Select 'Relay No' 32 and set 'Pulse/Follow' to 'C1>4'.

These settings will ensure that an event notification message is sent
to the plugin once every five seconds and immediately a physical relay
changs state.

### Plugin configuration

The plugin configuration has the following properties.

| Property               | Default     | Description |
| :--------------------- | :---------- | :---------- |
| modules                | []          | Required array property consisting of a collection of 'module' object properties each of which describes a particular DS relay device you wish the plugin to operate. |
| statusListenerPort     | 24281       | Optional TCP port number on which the plugin will listen for DS event notificataions. |
| transmitQueueHeartbeat | 25          | Optional transmit queue processing interval in milliseconds. This defines the frequency at which the plugin will check that a previously issued command has completed and so defines the maximum rate at which relay operating commands can be sent to a remote device. |
| devices                | (see below) | Optional array property consisting of a collection of 'device' objects each of which defines the operating characteristics of a Devantech product. A single device with the id 'DS' is defined by default. |

All that is required to get a working installation is the definition of a
'modules' property.
The test configuration for my DS2824 looks like this:
```
{
  "enabled": true,
  "enableDebug": true,
  "configuration": {
    "modules": [
      {
        "id": "DS2824",
        "description": "DS2824 Test Module",
        "deviceid": "DS",
        "cstring": "192.168.1.145:17123",
        "channels": [
          { "index": 1, "description": "Relay 1" },
          { "index": 2, "description": "Relay 2" },
          { "index": 3, "description": "Relay 3" },
          { "index": 4, "description": "Relay 4" },
          { "index": 5, "description": "Relay 5" },
          { "index": 6, "description": "Relay 6" },
          { "index": 7, "description": "Relay 7" },
          { "index": 8, "description": "Relay 8" }
        ]
      }
    ]
  }
}
``` 

Each 'module' object has the following properties.

| Property           | Default | Description |
| :----------------- | :------ | :---------- |
| id                 | (none)  | Required string property supplying a unique Signal K identifier for the module being defined. This value will be used as part of the Signal K path used to identify each relay switch channel. |
| cstring            | (none)  | Required string property supplying a connection string of the form '*address*:*port*' that identifes the physical device implementing this module and the TCP port number on which it listens for commands. |
| channels           | []      | Required array property containing a collection of *channel* definitions each of which describes one of the module's relay bank channels. |
| description        | ''      | Optional string property can be used to supply some documentary text about the module. |
| deviceid           | 'DS'    | Optional string property specifying the physical device to which this module definition relates. The value supplied here must be either the identifier of the plugin's default device (i.e. 'DS') or the identifier of a user-defined device (see below). |

Each *channel* object in the *channels* array has the following
properties.

| Property    | Default | Description |
| :---------- | ------- | :---------- |
| index       | (none)  | Required number property specifying the Signal K index of the module channel being defined (Signal K convention starts channel numbering at 1).  This value will be used as part of the Signal K path used to identify each relay switch channel. |
| address     | (none)  | Optional number property specifying the address of the physical channel on the remote device with which this channel is associated. If this property is omitted, then the plugin will use the value of the
'index' property as the channel address. |
| description | (none)  | Optional string property supplying some text for the meta data 'description' property that will be associated with the channel in Signal K. |

### Device definitions

A 'devices' array property can be included at the top-level of the
plugin configuration to add relay device definitions to those which are
pre-defined in the plugin or to override the existing 'DS' definition.
Each item in the 'devices' array is a *device* definition object which
describes the physical and interfacing characteristics of a supported
relay device.

The plugin includes this device definition suitable for DS-series relay
modules:
```
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
```
Each device definition has the following properties.

| Property      | Default | Description |
| :------------ | ------- | :---------- |
| id            | (none)  | Required string property supplying a space-separated list of identifiers, one
for each of the relay devices to which the definition applies. Typically these identifiers should be the model number assigned by the
device manufacturer. |
| channels      | []      | Required array property introduces a list of *channel* definitions each of which specifies the commands required to operate a particular relay on the device being defined. |

Relays are identified by an ordinal address in the range 1..[size] and
each channel can be defined explicitly, but if there is a common format
for commands that applies to all channels, then a pattern can be defined
for a fake, generic, channel with address 0 and this will be elaborated
for each of the real channels on the device.

Each channel definition has the following properties.

| Property            | Default | Description |
| :------------------ | ------- | :---------- |
| address             | (none)  | Number property giving the ordinal number of the relay channel that is being defined (or 0 for a generic definition). |
| oncommand           | (none)  | String property specifying the character sequence that should be transmitted to the device to turn the relay identified by 'address' ON. |
| offcommand          | (none)  | String property specifying the character sequence that should be transmitted to the device to turn the relay identified by 'address' OFF. |

Both 'oncommand' and 'offcommand' can contain embedded JSON escape
sequences.
Additionally, the following wildcard tokens will be substituted
with appropriate values before string transmission.

| Token | Replacement value |
| :---- | :---------------- |
| {c}   | The ASCII encoded address of the channel being processed. |
| {C}   | The binary encoded address of the channel being processed. |

## Operation

The plugin will start immediately it is installed but must be configured
with at least one 'module' definition before it can do something useful.

## Author

Paul Reeve <*preeve _at_pdjr_dot_eu*>
